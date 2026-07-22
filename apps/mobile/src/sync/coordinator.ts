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
}

export class SyncCoordinator implements Coordinator {
  private db: Database | null = null;
  private stopped = false;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  async start(db: Database): Promise<void> {
    if (this.stopped) return;
    this.db = db;
    this.stopped = false;

    // First sync: full pull (cursor null)
    const pull = await this.pull(null);
    await this.applyPull(pull);

    // Periodic sync setiap 30 detik
    this.syncInterval = setInterval(() => this.syncTick(), 30_000);
  }

  private async syncTick(): Promise<void> {
    if (this.stopped || !this.db) return;
    try {
      // Flush dirty records TERLEBIH DAHULU, baru pull
      await this.flushNow();
      const cursor = await loadCursor();
      const pull = await this.pull(cursor);
      await this.applyPull(pull);
    } catch {
      // Log error, skip — periodic sync tidak boleh crash app
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

    const payload = await this.collectDirty(this.db);
    if (payload.records.length === 0) return null;

    const resp = await pushBatch(payload);

    // Process acks: conflict = overwrite local row dengan data server
    await this.resolveAcks(resp.acks, this.db);

    // Simpan cursor dari pullDelta (kalau ada)
    await saveCursor(resp.pullDelta?.nextCursor ?? null);
    if (resp.pullDelta) await this.applyPull(resp.pullDelta);

    return resp;
  }

  // ============ pull ============

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
            r.id = record.id;
            this.applyServerDataToLocalRow(r, record);
            // Mark as synced (prepareCreate dari pull server, bukan perubahan user)
            r._raw._status = 'synced';
          }));
        }
      }
    }

    if (batch.length > 0) {
      await database.batch(...batch);
    }

    await saveCursor(pull.nextCursor);
  }

  /**
   * Apply server data ke local WatermelonDB row.
   *
   * DATA MAPPING:
   * - snake_case DB columns -> camelCase domain types
   * - JSON string columns (items_json, address_json, attachment_json) -> parsed objects
   *
   * MAPPING TABLE (WatermelonDB -> @delivery/shared):
   *
   * order:
   *   customer_id  -> customerId
   *   driver_id   -> driverId
   *   items_json  -> items (JSON.parse)
   *   address_json -> deliveryAddress (JSON.parse)
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
   *   attachment_json -> attachment (JSON.parse)
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
      row.itemsJson = JSON.stringify((d as any).items);
      row.addressJson = JSON.stringify((d as any).deliveryAddress);
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
      row.attachmentJson = (d as any).attachment
        ? JSON.stringify((d as any).attachment)
        : null;
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
        records.push(this.localRowToSyncRecord(row, colName));
      }
    }

    return { deviceId, userId, sinceCursor: cursor, records };
  }

  /**
   * Convert local WatermelonDB row ke SyncRecordPush.
   *
   * DATA MAPPING (inverse dari applyServerDataToLocalRow):
   * - camelCase domain types -> snake_case DB columns
   * - JSON object -> JSON.stringify untuk string columns
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
        items: row.itemsJson ? JSON.parse(row.itemsJson) : [],
        deliveryAddress: row.addressJson ? JSON.parse(row.addressJson) : {},
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
        attachment: row.attachmentJson ? JSON.parse(row.attachmentJson) : undefined,
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
      }
    }

    if (batch.length > 0) {
      await db.batch(...batch);
    }
  }
}

export const syncCoordinator = new SyncCoordinator();
