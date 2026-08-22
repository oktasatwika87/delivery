/**
 * Offline-first sync coordinator.
 *
 * - Batch push dirty records ke backend via flushNow().
 * - Pull incremental berdasarkan cursor (disimpan di AsyncStorage / MMKV).
 * - Periodic sync setiap 30 detik (flush + pull).
 *
 * Conflict resolution: kalau server return conflict, local row di-overwrite
 * dengan data server (baseVersion yang salah discard).
 */

import { Q } from '@nozbe/watermelondb';
import type { Database } from '@nozbe/watermelondb';
import type {
  SyncPullResponse,
  SyncRecordPull,
  SyncRecordPush,
  SyncPushPayload,
  SyncPushResponse,
} from '@delivery/shared';

import { pushBatch, pullBatch } from './client';
import { loadCursor, saveCursor } from './cursor';
import { getDeviceId } from './device';
import { getCurrentUserId } from './session';
import { syncEvents } from './syncEvents';

/**
 * Maximum consecutive failed sync attempts per record. After this many
 * `rejected` acks for the same row, sync coordinator stops collecting it
 * and flips the row to `FAILED_SYNC` status (where the model supports a
 * domain status field; otherwise stops silently). Prevents infinite
 * silent retry storms when the server consistently rejects a record.
 *
 * Sync tick adalah 30 detik, jadi 5 attempts ≈ 2.5 menit. Cukup untuk
 * ride out window offline pendek, cukup pendek agar kegagalan
 * permanen surfaced ke user.
 */
const MAX_SYNC_ATTEMPTS = 5;

interface Coordinator {
  start(db: Database): Promise<void>;
  stop(): void;
  /** Flush dirty records ke server (biasanya dipanggil manual dari UI). */
  flushNow(): Promise<SyncPushResponse | null>;
  /**
   * Pull data incremental dari server (reuse pull()+applyPull()).
   * Dipanggil manual setelah login agar data langsung muncul,
   * tanpa harus menunggu tick periodik berikutnya (~30s).
   */
  pullNow(): Promise<SyncPullResponse | null>;
}

export class SyncCoordinator implements Coordinator {
  private db: Database | null = null;
  private stopped = false;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  async start(db: Database): Promise<void> {
    // Reset stopped flag FIRST — allows restart after stop() was previously called
    this.stopped = false;

    // Already running? Skip interval setup to prevent double-mount.
    // Also skip initial pull to avoid duplicate work.
    if (this.syncInterval) {
      // Just update db reference in case it changed
      this.db = db;
      console.log('[SyncCoordinator] start() called — already running, skipping duplicate start');
      return;
    }

    console.log('[SyncCoordinator] start() called');
    this.db = db;

    // First sync: full pull (cursor null)
    // Bungkus try/catch supaya kegagalan pull pertama tidak menghalangi periodic sync
    try {
      console.log('[SyncCoordinator] Performing initial pull...');
      const pull = await this.pull(null);
      await this.applyPull(pull);
      console.log('[SyncCoordinator] Initial pull succeeded');
    } catch (err) {
      console.warn('[SyncCoordinator] Initial pull failed, will retry on next tick:', err);
    }

    // Periodic sync setiap 30 detik
    console.log('[SyncCoordinator] Starting periodic sync interval');
    this.syncInterval = setInterval(() => this.syncTick(), 30_000);
  }

  private async syncTick(): Promise<void> {
    if (this.stopped || !this.db) return;
    console.log('[syncTick] Running periodic sync...');
    try {
      // Flush dirty records TERLEBIH DAHULU, baru pull
      await this.flushNow();
      const cursor = await loadCursor();
      const pull = await this.pull(cursor);
      await this.applyPull(pull);
    } catch (err) {
      console.warn('[syncTick] Error:', err);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.db = null;
  }

  /** Flush dirty records ke server (biasanya dipanggil manual dari UI). */
  async flushNow(): Promise<SyncPushResponse | null> {
    if (this.stopped || !this.db) return null;

    console.log('[flushNow] Starting flush...');
    const payload = await this.collectDirty(this.db);
    console.log(`[flushNow] Collected ${payload.records.length} dirty records`);
    if (payload.records.length === 0) return null;

    let resp: SyncPushResponse;
    try {
      resp = await pushBatch(payload);
    } catch (err) {
      // Network gagal atau backend reject request — row lokal tetap dirty,
      // akan di-retry di sync cycle berikutnya. Log warning.
      console.warn('[flushNow] pushBatch failed, will retry next sync:', err);
      return null;
    }

    // Check if push timed out (empty acks means no server response)
    if (resp.acks.length === 0 && payload.records.length > 0) {
      // Timeout: increment failedSyncAttempts for all attempted records
      console.warn('[flushNow] pushBatch returned empty acks — treating as timeout');
      await this.markRecordsFailed(payload.records, this.db);
    }

    // Process acks: conflict = overwrite local row dengan data server
    // Events (orderConflict, orderRejected) di-emit di resolveAcks()
    await this.resolveAcks(resp.acks, this.db);

    // Simpan cursor dari pullDelta (kalau ada)
    await saveCursor(resp.pullDelta?.nextCursor ?? null);
    if (resp.pullDelta) await this.applyPull(resp.pullDelta);

    return resp;
  }

  /**
   * Mark records as failed due to timeout (no ack from server).
   * Increments failedSyncAttempts and flips status to FAILED if at cap.
   */
  private async markRecordsFailed(
    records: SyncRecordPush[],
    db: Database,
  ): Promise<void> {
    const batch: any[] = [];

    for (const record of records) {
      const collection = this.collectionFor(record.entityType, db);
      if (!collection) continue;

      const existing = await collection.find(record.id).catch(() => null);
      if (existing) {
        const currentAttempts = (existing as any).failedSyncAttempts ?? 0;
        const nextAttempts = currentAttempts + 1;

        batch.push(existing.prepareUpdate((r: any) => {
          r.failedSyncAttempts = nextAttempts;
          // For chat messages and payments, flip domain status to FAILED so UI can surface it
          if ((record.entityType === 'chat_message' || record.entityType === 'payment') && nextAttempts >= MAX_SYNC_ATTEMPTS) {
            (r as any).status = 'FAILED';
            console.error(
              `[markRecordsFailed] Record timed out after ${MAX_SYNC_ATTEMPTS} attempts — ${record.entityType} id=${record.id} marked FAILED.`,
            );
          } else if (nextAttempts >= MAX_SYNC_ATTEMPTS) {
            console.error(
              `[markRecordsFailed] Record timed out after ${MAX_SYNC_ATTEMPTS} attempts — ${record.entityType} id=${record.id}.`,
            );
          }
        }));

        if (nextAttempts < MAX_SYNC_ATTEMPTS) {
          console.warn(
            `[markRecordsFailed] Record timed out: entityType=${record.entityType}, id=${record.id}`,
            `attempt ${nextAttempts}/${MAX_SYNC_ATTEMPTS}`,
          );
        }
      }
    }

    if (batch.length > 0) {
      try {
        await db.write(async () => {
          await db.batch(...batch);
        });
      } catch (err) {
        console.error('[markRecordsFailed] Failed to write batch:', err);
      }
    }
  }

  // ============ pull ============

  /**
   * Manual pull — panggil setelah login (atau event lain yang butuh
   * data server segera) supaya tidak harus menunggu tick periodik
   * berikutnya. Reuse pull() dan applyPull() yang sudah ada; TIDAK
   * menduplikasi logic.
   */
  async pullNow(): Promise<SyncPullResponse | null> {
    if (this.stopped || !this.db) return null;
    console.log('[SyncCoordinator] pullNow() called — manual pull');
    try {
      const cursor = await loadCursor();
      const pull = await this.pull(cursor);
      await this.applyPull(pull);
      console.log(
        '[SyncCoordinator] pullNow() succeeded, records:',
        pull.records.length,
      );
      return pull;
    } catch (err) {
      console.warn('[SyncCoordinator] pullNow() failed:', err);
      return null;
    }
  }

  private async pull(sinceCursor: string | null): Promise<SyncPullResponse> {
    if (this.stopped) {
      return { nextCursor: null, records: [], serverTime: new Date().toISOString() };
    }
    const deviceId = await getDeviceId();
    return pullBatch(deviceId, sinceCursor);
  }

  // ============ applyPull ============
  // Map entityType -> collection (use any untuk simplicity)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private collectionFor(entityType: SyncRecordPull['entityType'], db?: any): any {
    const database = db ?? this.db;
    if (!database) return null;
    switch (entityType) {
      case 'order': return database.get('orders');
      case 'payment': return database.get('payments');
      case 'chat_message': return database.get('chat_messages');
      default: return null;
    }
  }

  private async applyPull(pull: SyncPullResponse, db?: Database): Promise<void> {
    if (this.stopped) return;
    const database = db ?? this.db;
    if (!database) return;
    if (pull.records.length === 0) return;

    const batch: any[] = [];

    for (const record of pull.records) {
      const collection = this.collectionFor(record.entityType, database);
      if (!collection) continue;

      if (record.deleted) {
        // Soft delete lokal — cari row, kalau ada, mark deleted_at
        const existing = await collection.find(record.id).catch(() => null);
        if (existing) {
          batch.push(existing.prepareUpdate((r: any) => {
            r.deletedAt = Date.now();
            r.serverVersion = record.serverVersion;
            // Mark as synced agar tidak dianggap dirty di collectDirty() berikutnya
            r._raw._status = 'synced';
          }));
        }
      } else {
        // Upsert: create kalau belum ada, update kalau sudah ada
        const existing = await collection.find(record.id).catch(() => null);

        if (existing) {
          batch.push(existing.prepareUpdate((r: any) => {
            this.applyServerDataToLocalRow(r, record);
            // Mark as synced agar tidak dianggap dirty di collectDirty() berikutnya
            r._raw._status = 'synced';
          }));
        } else {
          batch.push(collection.prepareCreate((r: any) => {
            // Set id via _raw because r.id is readonly in WatermelonDB Model
            // Must use server's UUID so sync push back works correctly
            r._raw.id = record.id;
            this.applyServerDataToLocalRow(r, record);
            // Mark as synced (prepareCreate dari pull server, bukan perubahan user)
            r._raw._status = 'synced';
          }));
        }
      }
    }

    if (batch.length > 0) {
      await database.write(async () => {
        await database.batch(...batch);
      });
    }

    await saveCursor(pull.nextCursor);
  }

  /**
   * Apply server data ke local WatermelonDB row.
   *
   * DATA MAPPING:
   * - snake_case DB columns -> camelCase domain types
   * - JSON string columns (items_json, address_json, attachment_json) -> parsed objects
   *   NOTE: @json decorator di OrderModel auto-parses on read & auto-stringifies on write
   *   DO NOT call JSON.stringify/JSON.parse manually — assign raw objects directly.
   *
   * MAPPING TABLE (WatermelonDB -> @delivery/shared):
   *
   * order:
   *   customer_id  -> customerId
   *   driver_id   -> driverId
   *   items_json  -> items (direct, @json handles serialization)
   *   address_json -> deliveryAddress (direct, @json handles serialization)
   *   server_version -> version
   *
   * payment:
   *   order_id -> orderId
   *   idempotency_key -> idempotencyKey
   *   external_ref -> externalRef
   *   server_version -> version
   *
   * chat_message:
   *   room_id -> roomId
   *   sender_id -> senderId
   *   attachment_json -> attachment (direct, @json handles serialization)
   *   client_created_at -> clientCreatedAt
   *   server_created_at -> serverCreatedAt
   *   server_version -> version
   */
  private applyServerDataToLocalRow(row: any, record: SyncRecordPull): void {
    const d = record.data;
    row.serverVersion = record.serverVersion;

    if (record.entityType === 'order') {
      row.customerId = (d as any).customerId;
      row.driverId = (d as any).driverId ?? null;
      row.status = (d as any).status;
      // @json decorator auto-stringify on write — assign raw object
      row.itemsJson = (d as any).items;
      row.addressJson = (d as any).deliveryAddress;
      row.totalCents = (d as any).totalCents;
      row.currency = (d as any).currency;
      row.notes = (d as any).notes ?? null;
      row.cancelledBy = (d as any).cancelledBy ?? null;
      row.cancelReason = (d as any).cancelReason ?? null;
    } else if (record.entityType === 'payment') {
      row.orderId = (d as any).orderId;
      row.idempotencyKey = (d as any).idempotencyKey;
      row.method = (d as any).method;
      row.status = (d as any).status;
      row.amountCents = (d as any).amountCents;
      row.currency = (d as any).currency;
      row.kind = (d as any).kind;
      row.externalRef = (d as any).externalRef ?? null;
    } else if (record.entityType === 'chat_message') {
      row.roomId = (d as any).roomId;
      row.senderId = (d as any).senderId;
      row.body = (d as any).body;
      // @json decorator auto-stringify on write — assign raw object
      row.attachmentJson = (d as any).attachment ?? null;
      row.status = (d as any).status;
      row.clientCreatedAt = new Date((d as any).clientCreatedAt).getTime();
      row.serverCreatedAt = (d as any).serverCreatedAt
        ? new Date((d as any).serverCreatedAt).getTime()
        : null;
    }
  }

  // ============ collectDirty ============

  private async collectDirty(db: Database): Promise<SyncPushPayload> {
    const deviceId = await getDeviceId();
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Not authenticated — cannot sync without login');
    const cursor = await loadCursor();
    const records: SyncRecordPush[] = [];

    // Query dirty records dari semua collection
    const collections = ['orders', 'payments', 'chat_messages'] as const;

    for (const colName of collections) {
      const collection = db.get(colName);

      // WatermelonDB internal _status (pada row._raw._status, BUKAN row._status):
      // 'created' = baru dibuat lokal, blm pernah sync
      // 'updated' = dimodifikasi lokal, blm sync
      // 'deleted' = ditandai hapus lokal
      // null / undefined = synced
      const dirty = await collection.query(
        Q.or(
          Q.where('_status', 'created'),
          Q.where('_status', 'updated'),
          Q.where('_status', 'deleted'),
        ),
      ).fetch();

      for (const row of dirty) {
        // Skip rows yang sudah melewati retry cap — resolveAcks() sudah
        // tandai mereka FAILED_SYNC dan increment failedSyncAttempts.
        // Mereka tidak akan pernah disinkronkan ulang, menghindari
        // silent retry storm.
        const raw = (row as any)._raw;
        const attempts = (row as any).failedSyncAttempts ?? 0;
        if (attempts >= MAX_SYNC_ATTEMPTS) {
          console.warn(
            `[collectDirty] Skipping ${colName}: id=${row.id} — hit retry cap (${attempts}/${MAX_SYNC_ATTEMPTS})`,
          );
          continue;
        }

        // DEBUG: Log all dirty records
        const syncRecord = this.localRowToSyncRecord(row, colName);
        console.log(`[collectDirty] ${colName}: id=${syncRecord.id}, _status=${raw._status}, op=${syncRecord.op}, baseVersion=${syncRecord.baseVersion}, attempts=${attempts}`);
        records.push(syncRecord);
      }
    }

    return { deviceId, userId, sinceCursor: cursor, records };
  }

  /**
   * Convert local WatermelonDB row ke SyncRecordPush.
   *
   * DATA MAPPING (inverse dari applyServerDataToLocalRow):
   * - camelCase domain types -> snake_case DB columns
   *   NOTE: @json decorator auto-parses on read, so use fields directly without JSON.parse.
   *
   * _raw._status mapping:
   * - 'created' -> op: 'create', baseVersion: null
   * - 'updated' -> op: 'update', baseVersion: row.serverVersion
   * - 'deleted' -> op: 'delete', baseVersion: row.serverVersion
   *
   * PENTING: baca dari row._raw._status, BUKAN row._status. Model-model
   * WatermelonDB tidak expose `_status` sebagai getter, jadi
   * `row._status` selalu undefined dan akan selalu jatuh ke `op='update'`,
   * yang menyebabkan server reject "Entity not found" terus-menerus.
   */
  private localRowToSyncRecord(row: any, colName: string): SyncRecordPush {
    const raw = row._raw as { _status?: string };
    const status = raw._status as string;
    const baseVersion = status === 'created' ? null : (row.serverVersion as number);

    // Determine op
    let op: 'create' | 'update' | 'delete';
    if (status === 'created') op = 'create';
    else if (status === 'deleted') op = 'delete';
    else op = 'update';

    // Map columns based on entity type
    let data: any;

    if (colName === 'orders') {
      data = {
        id: row.id,
        customerId: row.customerId,
        driverId: row.driverId ?? undefined,
        status: row.status,
        // @json decorator auto-parse on read — use directly
        items: row.itemsJson ?? [],
        deliveryAddress: row.addressJson ?? {},
        totalCents: row.totalCents,
        currency: row.currency,
        notes: row.notes ?? undefined,
        cancelledBy: row.cancelledBy ?? undefined,
        cancelReason: row.cancelReason ?? undefined,
        version: row.serverVersion,
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
      };
    } else if (colName === 'payments') {
      let idempotencyKey = row.idempotencyKey;
      if (!idempotencyKey) {
        // Defensive: a payment row without idempotencyKey is a data integrity
        // issue (every COD row should have one from creation). Generate a
        // fallback so the push payload is well-formed and server-side
        // dedup still has something to work with.
        //
        // Do NOT writeback to the row here — collectDirty() is called from
        // concurrent sync paths and writeback during read phase is racy.
        // The next legitimate edit to this row (or another sync cycle) will
        // re-trigger this fallback, which is acceptable for the recovery path.
        const fallbackKey = `cod:${(typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`}`;
        console.warn(
          `[localRowToSyncRecord] payment row ${row.id} missing idempotencyKey — ` +
          `generating fallback "${fallbackKey}". This indicates a data integrity ` +
          `issue (should have been set at create time).`
        );
        idempotencyKey = fallbackKey;
      }
      data = {
        id: row.id,
        orderId: row.orderId,
        idempotencyKey,
        method: row.method,
        status: row.status,
        amountCents: row.amountCents,
        currency: row.currency,
        kind: row.kind,
        externalRef: row.externalRef ?? undefined,
        version: row.serverVersion,
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
      };
    } else if (colName === 'chat_messages') {
      data = {
        id: row.id,
        roomId: row.roomId,
        senderId: row.senderId,
        body: row.body,
        // @json decorator auto-parse on read — use directly
        attachment: row.attachmentJson ?? undefined,
        status: row.status,
        clientCreatedAt: new Date(row.clientCreatedAt).toISOString(),
        serverCreatedAt: row.serverCreatedAt
          ? new Date(row.serverCreatedAt).toISOString()
          : undefined,
        version: row.serverVersion,
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
      };
    }

    return {
      entityType: colName === 'orders' ? 'order'
        : colName === 'payments' ? 'payment'
        : 'chat_message',
      id: row.id,
      data,
      op,
      clientChangedAt: new Date().toISOString(),
      baseVersion,
    };
  }

  /**
   * Find a local dirty payment row matching an ack. Used when the ack's `id`
   * doesn't match any local row but `serverData.idempotencyKey` does match
   * a dirty local row. This handles the "first push succeeded on server but
   * ack was lost — second push gets existing-server-id as ack.id" case.
   */
  private async findLocalPaymentByAck(
    collection: any,
    ack: SyncPushResponse['acks'][number],
  ): Promise<any | null> {
    // First try by ack.id (fast path)
    const byId = await collection.find(ack.id).catch(() => null);
    if (byId) return byId;

    // Fallback: match by idempotencyKey from serverData (payment-specific)
    if (ack.entityType !== 'payment' || !ack.serverData?.idempotencyKey) {
      return null;
    }
    const idempotencyKey = ack.serverData.idempotencyKey;
    const dirtyRows = await collection
      .query(
        Q.where('_status', Q.notEq('synced')),
      )
      .fetch();
    const matched = dirtyRows.find((r: any) => r.idempotencyKey === idempotencyKey);
    if (matched) {
      console.log(
        `[resolveAcks] payment ack-id mismatch: server id=${ack.id}, ` +
        `matched local row by idempotencyKey=${idempotencyKey}, local id=${matched.id}`,
      );
    }
    return matched ?? null;
  }

  // ============ resolveAcks ============

  /**
   * Process ack dari server push.
   * - Conflict: overwrite local row dengan serverData, mark synced
   * - Accepted: mark local row synced
   * - Rejected: log warning (row tetap dirty, akan di-retry next sync cycle)
   */
  private async resolveAcks(
    acks: SyncPushResponse['acks'],
    db: Database,
  ): Promise<void> {
    const batch: any[] = [];

    for (const ack of acks) {
      if (ack.status === 'conflict' && ack.serverData) {
        // Overwrite local row dengan data server terbaru
        const collection = this.collectionFor(ack.entityType, db);
        if (!collection) continue;

        const existing = await this.findLocalPaymentByAck(collection, ack);
        if (existing) {
          batch.push(existing.prepareUpdate((r: any) => {
            r.serverVersion = ack.serverVersion;
            this.applyServerDataToLocalRow(r, {
              entityType: ack.entityType,
              id: ack.id,
              serverVersion: ack.serverVersion,
              serverChangedAt: ack.serverChangedAt,
              deleted: false,
              data: ack.serverData!,
            });
            // Mark as synced agar tidak dianggap dirty di collectDirty() berikutnya
            r._raw._status = 'synced';
          }));

          // Emit event untuk order entity
          if (ack.entityType === 'order') {
            const serverDriverId = (ack.serverData as any).driverId;
            const currentUserId = await getCurrentUserId();
            const isAcceptedByOther = serverDriverId != null && serverDriverId !== currentUserId;

            const reason = isAcceptedByOther ? 'accepted-by-other' : 'order-status-conflict';

            syncEvents.emit('orderConflict', {
              orderId: ack.id,
              reason,
              serverStatus: (ack.serverData as any).status ?? 'unknown',
              serverChangedAt: ack.serverChangedAt ?? new Date().toISOString(),
            });

            // orderRemovedFromView HANYA emit kalau order di-accept oleh driver lain
            if (isAcceptedByOther) {
              syncEvents.emit('orderRemovedFromView', {
                orderId: ack.id,
              });
            }
          }
        }
      } else if (ack.status === 'accepted') {
        // Accepted: update serverVersion, mark synced
        const collection = this.collectionFor(ack.entityType, db);
        if (!collection) continue;

        const existing = await this.findLocalPaymentByAck(collection, ack);
        if (existing) {
          batch.push(existing.prepareUpdate((r: any) => {
            r.serverVersion = ack.serverVersion;
            // Mark as synced agar tidak dianggap dirty di collectDirty() berikutnya
            r._raw._status = 'synced';
            // Flip domain status: chat_message -> SENT, payment -> CAPTURED
            // Ini fix C3 — tanpa ini, pesan chat sync-path tampil 'mengirim...'
            // selamanya padahal sudah sukses terkirim ke server.
            if (ack.entityType === 'chat_message') {
              r.status = 'SENT';
            } else if (ack.entityType === 'payment') {
              // Use serverData status if available, fallback to CAPTURED
              const serverStatus = (ack as any).serverData?.status;
              r.status = serverStatus ?? 'CAPTURED';
            }
          }));
        }
      } else if (ack.status === 'rejected') {
        // Rejected: increment retry counter, cap at MAX_SYNC_ATTEMPTS.
        // After hitting the cap, stop collecting — avoids infinite retry storms.
        const collection = this.collectionFor(ack.entityType, db);
        if (!collection) continue;

        const existing = await collection.find(ack.id).catch(() => null);
        if (existing) {
          const currentAttempts = (existing as any).failedSyncAttempts ?? 0;
          const nextAttempts = currentAttempts + 1;

          batch.push(existing.prepareUpdate((r: any) => {
            r.failedSyncAttempts = nextAttempts;
            // For chat messages and payments, flip domain status to FAILED so UI can surface it
            // Orders do NOT have a FAILED domain status — no status flip for orders
            if ((ack.entityType === 'chat_message' || ack.entityType === 'payment') && nextAttempts >= MAX_SYNC_ATTEMPTS) {
              (r as any).status = 'FAILED';
              console.error(
                `[resolveAcks] Record permanently rejected after ${MAX_SYNC_ATTEMPTS} attempts — ${ack.entityType} id=${ack.id} marked FAILED. ` +
                `User should be notified. Server reason: ${ack.reason ?? 'unknown'}`,
              );
            } else if (nextAttempts >= MAX_SYNC_ATTEMPTS) {
              console.error(
                `[resolveAcks] Record permanently rejected after ${MAX_SYNC_ATTEMPTS} attempts — ${ack.entityType} id=${ack.id}. ` +
                `Sync coordinator will stop retrying. Server reason: ${ack.reason ?? 'unknown'}`,
              );
            }
          }));

          console.warn(
            `[resolveAcks] Record rejected by server: entityType=${ack.entityType}, id=${ack.id}`,
            ack.reason ? `reason=${ack.reason}` : '',
            `attempt ${nextAttempts}/${MAX_SYNC_ATTEMPTS}`,
          );

          // Emit event untuk order entity
          if (ack.entityType === 'order') {
            syncEvents.emit('orderRejected', {
              orderId: ack.id,
              reason: ack.reason ?? 'unknown',
            });
          }
        } else {
          console.warn(
            `[resolveAcks] Record rejected but not found locally: entityType=${ack.entityType}, id=${ack.id}`,
            ack.reason ? `reason=${ack.reason}` : '',
          );
        }
      }
    }

    if (batch.length > 0) {
      try {
        await db.write(async () => {
          await db.batch(...batch);
        });
      } catch (err) {
        console.error('[resolveAcks] Failed to write batch:', err);
      }
    }
  }
}

export const syncCoordinator = new SyncCoordinator();
