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
    if (this.stopped) return;
    console.log('[SyncCoordinator] start() called');
    this.db = db;
    this.stopped = false;

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

    // Process acks: conflict = overwrite local row dengan data server
    await this.resolveAcks(resp.acks, this.db);

    // Simpan cursor dari pullDelta (kalau ada)
    await saveCursor(resp.pullDelta?.nextCursor ?? null);
    if (resp.pullDelta) await this.applyPull(resp.pullDelta);

    return resp;
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

      // WatermelonDB internal _status:
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
        // DEBUG: Log all dirty records
        const syncRecord = this.localRowToSyncRecord(row, colName);
        console.log(`[collectDirty] ${colName}: id=${syncRecord.id}, _status=${(row as any)._status}, op=${syncRecord.op}, baseVersion=${syncRecord.baseVersion}`);
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
   * _status mapping:
   * - 'created' -> op: 'create', baseVersion: null
   * - 'updated' -> op: 'update', baseVersion: row.serverVersion
   * - 'deleted' -> op: 'delete', baseVersion: row.serverVersion
   */
  private localRowToSyncRecord(row: any, colName: string): SyncRecordPush {
    const status = row._status as string;
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
        version: row.serverVersion,
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
      };
    } else if (colName === 'payments') {
      data = {
        id: row.id,
        orderId: row.orderId,
        idempotencyKey: row.idempotencyKey,
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

        const existing = await collection.find(ack.id).catch(() => null);
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
        }
      } else if (ack.status === 'accepted') {
        // Accepted: update serverVersion, mark synced
        const collection = this.collectionFor(ack.entityType, db);
        if (!collection) continue;

        const existing = await collection.find(ack.id).catch(() => null);
        if (existing) {
          batch.push(existing.prepareUpdate((r: any) => {
            r.serverVersion = ack.serverVersion;
            // Mark as synced agar tidak dianggap dirty di collectDirty() berikutnya
            r._raw._status = 'synced';
          }));
        }
      } else if (ack.status === 'rejected') {
        // Rejected: row tetap dirty, akan di-retry next sync
        console.warn(
          `[resolveAcks] Record rejected by server: entityType=${ack.entityType}, id=${ack.id}`,
          ack.reason ? `reason=${ack.reason}` : '',
        );
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
