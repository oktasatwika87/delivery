/**
 * Offline-first sync coordinator.
 *
 * - Batch push dirty records ke backend via flushNow().
 * - Pull incremental berdasarkan cursor (disimpan di AsyncStorage / MMKV).
 * - Periodic sync setiap 30 detik (flush + pull).
 *
 * Conflict resolution: kalau server return conflict, local row ditimpa
 * dengan data server (baseVersion yang salah discard).
 */

import { Q } from '@nozbe/watermelondb';
import type { Database, Model } from '@nozbe/watermelondb';
import reactNativeUUID from 'react-native-uuid';
import type {
  ChatMessage,
  Order,
  Payment,
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
import { networkMonitor } from '../map/networkMonitor';
import { OrderModel } from '../db/models/OrderModel';
import { PendingActionModel } from '../db/models/PendingActionModel';

/**
 * Batas ack 'rejected' berturut-turut untuk satu baris. Setelah batas ini
 * baris tidak dikirim lagi, dan pesan chat atau payment ditandai FAILED.
 * Push yang habis waktu dan galat jaringan tidak dihitung.
 */
const MAX_SYNC_ATTEMPTS = 5;

/**
 * Parse string ISO 8601 jadi epoch milliseconds, atau null kalau input
 * tidak valid (bukan string, string kosong, atau string yang gagal di-parse
 * oleh Date constructor). Dipakai oleh buildRawRowForCreate untuk
 * konversi createdAt dari server (ISO string) jadi nilai kolom number
 * `created_at` / `client_created_at` / `server_created_at` di schema.
 */
function parseIsoMsOrNull(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

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
  /** Unsubscribe from networkMonitor, stored so we can clean up on stop(). */
  private networkUnsubscribe: (() => void) | null = null;
  /** Track last known network status to detect reconnect events. */
  private lastNetworkStatus: 'online' | 'offline' | 'unknown' = 'unknown';
  /** Generation counter, dinaikkan setiap stop(). Pemanggil ambil
   * nomor ini sebelum request dikirim dan meneruskannya ke applyPull.
   * Kalau generasi berubah saat penulis DB berjalan (mis. data lokal
   * sudah dibersihkan untuk akun lain), tulisan tidak dijalankan
   * tanpa menyentuh baris sesi lama. */
  private generation = 0;

  async start(db: Database): Promise<void> {
    // Selalu perbarui referensi db dulu, walaupun panggilan start()
    // dilewati karena sudah jalan; instance db harus tetap segar.
    this.db = db;
    this.stopped = false;

    // Kalau coordinator sudah jalan (interval terpasang), hanya
    // perbarui db dan selesai. Tidak ada pull tambahan.
    if (this.syncInterval) {
      console.log('[SyncCoordinator] start() called, already running, skipping duplicate interval');
      return;
    }

    console.log('[SyncCoordinator] start() called');

    // Pantau status jaringan supaya outbox dikirim saat koneksi kembali.
    this.setupNetworkListener();

    // Interval 30 detik dipasang SEBELUM pull pertama, supaya pull
    // berikutnya tidak tertunda kalau pull pertama masih lama
    // (mis. jaringan lambat).
    this.syncInterval = setInterval(() => this.syncTick(), 30_000);

    // Pull pertama dengan generasi yang sama yang akan diteruskan ke
    // applyPull; start() selesai setelah pull pertama selesai
    // diterapkan (tes lama `await coordinator.start(db)` bergantung).
    const gen = this.generation;
    try {
      console.log('[SyncCoordinator] Performing initial pull...');
      const pull = await this.pull(null);
      await this.applyPull(pull, undefined, gen);
      console.log('[SyncCoordinator] Initial pull succeeded');
    } catch (err) {
      console.warn('[SyncCoordinator] Initial pull failed, will retry on next tick:', err);
    }
  }

  /**
   * Subscribe ke networkMonitor dan drain outbox setiap perpindahan
   * ke 'online' dari status lain, termasuk 'unknown' saat app dibuka
   * atau aktif lagi.
   */
  private async setupNetworkListener(): Promise<void> {
    // Clean up any existing subscription
    if (this.networkUnsubscribe) {
      this.networkUnsubscribe();
    }

    // Initialize lastNetworkStatus from current state
    this.lastNetworkStatus = networkMonitor.getStatus();

    this.networkUnsubscribe = networkMonitor.subscribe(async (status) => {
      if (this.stopped) return;

      console.log(`[SyncCoordinator] Network status changed: ${this.lastNetworkStatus} -> ${status}`);

      // Drain setiap perpindahan ke 'online' dari status lain ('offline'
      // atau 'unknown'), supaya aksi yang masuk saat app dibuka online
      // (mis. COD yang dicatat sebelum app kembali ke latar) ikut terkirim.
      if (status === 'online' && this.lastNetworkStatus !== 'online') {
        console.log('[SyncCoordinator] Online detected, draining pending actions...');
        try {
          // Dynamic import to avoid circular dependency with WatermelonDB
          const { drainPendingActions } = await import('./outbox');
          const results = await drainPendingActions(this.db!);
          const succeeded = results.filter((r: { status: string }) => r.status === 'success').length;
          const conflicts = results.filter((r: { status: string }) => r.status === 'conflict').length;
          const orphaned = results.filter((r: { status: string }) => r.status === 'orphaned').length;
          const failed = results.filter((r: { status: string }) => r.status === 'failed').length;
          console.log(
            `[SyncCoordinator] Drain complete: ${succeeded} success, ${conflicts} conflicts, ${orphaned} orphaned, ${failed} failed`
          );
        } catch (err) {
          console.error('[SyncCoordinator] Error draining pending actions:', err);
        }
      }

      this.lastNetworkStatus = status;
    });
  }

  private async syncTick(): Promise<void> {
    if (this.stopped || !this.db) return;
    console.log('[syncTick] Running periodic sync...');
    const tickGen = this.generation;
    try {
      // Selama online, outbox dikirim dulu di tiap sinkron berkala, supaya aksi
      // yang gagal karena gangguan sementara (jaringan, 5xx) dicoba lagi tanpa
      // menunggu koneksi putus lalu tersambung.
      if (networkMonitor.getStatus() === 'online') {
        try {
          const { drainPendingActions } = await import('./outbox');
          await drainPendingActions(this.db);
        } catch (err) {
          // Kalau pengiriman outbox gagal, flushNow dan pull tetap jalan.
          console.warn('[syncTick] drain failed, continuing with flush+pull:', err);
        }
      }
      // Flush dirty records TERLEBIH DAHULU, baru pull
      await this.flushNow();
      const cursor = await loadCursor();
      const pull = await this.pull(cursor);
      await this.applyPull(pull, undefined, tickGen);
    } catch (err) {
      console.warn('[syncTick] Error:', err);
    }
  }

  stop(): void {
    // Naikkan generasi supaya applyPull yang sedang antre di write
    // WatermelonDB tidak dijalankan tanpa menulis baris sesi lama.
    // Penulisan WatermelonDB antre per-batch; pull sesi lama bisa baru
    // berjalan setelah data lokal dibersihkan untuk akun lain.
    this.generation++;
    this.stopped = true;
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.networkUnsubscribe) {
      this.networkUnsubscribe();
      this.networkUnsubscribe = null;
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

    // Generation dibaca sebelum request dikirim, supaya applyPull di
    // dalam pullDelta tidak dijalankan kalau sesi sudah berakhir.
    const pullGen = this.generation;

    let resp: SyncPushResponse;
    try {
      resp = await pushBatch(payload);
    } catch (err) {
      // Network gagal atau backend reject request, row lokal tetap dirty,
      // akan di-retry di sync cycle berikutnya. Log warning.
      // auth-expired dipancarkan lewat fetchWithAuth pada request berikutnya
      // kalau token sudah tidak berlaku; jalur lain cukup catat.
      console.warn('[flushNow] pushBatch failed, will retry next sync:', err);

      return null;
    }

    // Acks kosong berarti request habis waktu (pushBatch membatalkannya
    // setelah 8 detik). Diperlakukan sama seperti galat jaringan: baris tetap
    // kotor, dikirim lagi di sinkron berikutnya, dan tidak dihitung ke batas
    // percobaan.
    if (resp.acks.length === 0 && payload.records.length > 0) {
      console.warn('[flushNow] push habis waktu, dikirim lagi di sinkron berikutnya');
      return null;
    }

    // Process acks: conflict = timpa local row dengan data server
    // Events (orderConflict, orderRejected) di-emit di resolveAcks()
    await this.resolveAcks(resp.acks, this.db);

    // Simpan cursor dari pullDelta (kalau ada). Generation diteruskan
    // supaya applyPull di dalam pullDelta tidak dijalankan kalau
    // sesi sudah berakhir.
    await saveCursor(resp.pullDelta?.nextCursor ?? null);
    if (resp.pullDelta) await this.applyPull(resp.pullDelta, undefined, pullGen);

    return resp;
  }

  // ============ pull ============

  /**
   * Manual pull, panggil setelah login (atau event lain yang butuh
   * data server segera) supaya tidak harus menunggu tick periodik
   * berikutnya. Reuse pull() dan applyPull() yang sudah ada, TIDAK
   * menduplikasi logic.
   */
  async pullNow(): Promise<SyncPullResponse | null> {
    if (this.stopped || !this.db) return null;
    console.log('[SyncCoordinator] pullNow() called, manual pull');
    const pullGen = this.generation;
    try {
      const cursor = await loadCursor();
      const pull = await this.pull(cursor);
      await this.applyPull(pull, undefined, pullGen);
      console.log(
        '[SyncCoordinator] pullNow() succeeded, records:',
        pull.records.length,
      );
      return pull;
    } catch (err) {
      // auth-expired dipancarkan lewat fetchWithAuth kalau token tidak
      // berlaku; jalur ini cukup catat supaya tidak muncul dua kali.
      console.warn('[SyncCoordinator] pullNow() failed:', err);
      return null;
    }
  }

  private async pull(sinceCursor: string | null): Promise<SyncPullResponse> {
    if (this.stopped) {
      return { nextCursor: null, records: [], serverTime: new Date().toISOString() };
    }
    const deviceId = await getDeviceId();
    const heldOrderIds = await this.collectHeldOrderIds(this.db);
    return pullBatch(deviceId, sinceCursor, heldOrderIds);
  }

  /**
   * Kumpulkan id order yang dipegang akun yang login: status aktif dan
   * deleted_at kosong. Server memakai daftar ini untuk melaporkan mana yang
   * sudah bukan miliknya (releasedOrders). Paling banyak 100 id.
   *
   * Belum login atau DB belum ada: daftar kosong.
   */
  private async collectHeldOrderIds(db: Database | null): Promise<string[]> {
    if (!db) return [];
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const held = await db
      .get<Model>('orders')
      .query(
        Q.where('driver_id', userId),
        Q.where('status', Q.oneOf(['ASSIGNED', 'PREPARING', 'OUT_FOR_DELIVERY'])),
        Q.where('deleted_at', null),
      )
      .fetch();
    return held.map((row) => row.id).slice(0, 100);
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

  private async applyPull(pull: SyncPullResponse, db?: Database, generation?: number): Promise<void> {
    if (this.stopped) return;
    const database = db ?? this.db;
    if (!database) return;
    // Tidak ada data sama sekali (records kosong, releasedOrders kosong atau tidak ada):
    // keluar lebih awal, cursor tidak disimpan.
    const releasedOrders = pull.releasedOrders ?? [];
    if (pull.records.length === 0 && releasedOrders.length === 0) return;

    // getCurrentUserId dibaca sebelum database.write, hanya kalau ada
    // releasedOrders untuk diproses. null berarti releasedOrders diabaikan
    // (sama dengan daftar kosong).
    let currentUserId: string | null = null;
    if (releasedOrders.length > 0) {
      currentUserId = await getCurrentUserId();
    }

    // writeApplied menandai apakah fungsi penulis benar-benar menulis
    // (generation masih cocok saat write berjalan). Kalau generasi sudah
    // berubah, kursor tidak disimpan dan pool-refresh tidak dipancarkan,
    // supaya sesi baru tidak mewarisi state dari pull yang sudah berakhir.
    let writeApplied = true;
    let releasedMarkedCount = 0;

    // find() dan penulisan batch berjalan di dalam SATU database.write.
    await database.write(async () => {
      // Pemeriksaan generasi di dalam write supaya penulisan sesi lama
      // yang baru jalan setelah stop() + start() + clearLocalData()
      // tidak dijalankan tanpa menyentuh baris. Penulisan WatermelonDB
      // antre, jadi penulisan sesi lama yang terlanjur masuk antrian
      // write tidak dijalankan di sini, bukan sebelumnya.
      if (typeof generation === 'number' && generation !== this.generation) {
        console.warn('[SyncCoordinator] applyPull: stale generation, skipping write');
        writeApplied = false;
        return;
      }
      const batch: any[] = [];
      const ordersCollection = database.get<OrderModel>('orders');

      // Versi laporan per id order.
      const releaseById = new Map<string, number>();
      for (const entry of releasedOrders) {
        releaseById.set(entry.id, entry.version);
      }
      // Order yang ada di records dan juga di laporan diputuskan di sini,
      // sebelum prepareUpdate apa pun. Versi laporan sama atau lebih besar:
      // record dilewati dan laporan tetap dipakai. Lebih kecil: record dipakai
      // dan laporan diabaikan. Dengan begitu satu baris tidak pernah disiapkan
      // dua kali dalam satu batch.
      const skipRecordIds = new Set<string>();
      for (const record of pull.records) {
        if (record.entityType !== 'order') continue;
        const reportVer = releaseById.get(record.id);
        if (typeof reportVer !== 'number') continue;
        if (reportVer >= record.serverVersion) {
          skipRecordIds.add(record.id);
        } else {
          releaseById.delete(record.id);
        }
      }
      const rowsToRelease = new Set<string>();
      // Aksi update_status/cancel/reject yang akan dihapus per order.
      const actionsToDelete = new Map<string, string[]>();

      // pending_actions dibaca di dalam write yang sama dengan penulisan
      // records.
      const pendingActionsCollection = database.get<PendingActionModel>('pending_actions');

      for (const [orderId, reportVersion] of releaseById) {
        if (currentUserId === null) break;
        const existing = await ordersCollection.find(orderId).catch(() => null);
        if (!existing) continue;
        // Hanya baris yang driver_id-nya akun yang login.
        const existingDriverId = existing._getRaw('driver_id');
        if (existingDriverId !== currentUserId) continue;
        // Versi lokal berupa angka dan lebih besar dari versi laporan: baris
        // sudah lebih baru, laporan diabaikan.
        const localVersion = existing._getRaw('server_version');
        if (typeof localVersion === 'number' && localVersion > reportVersion) continue;
        // Aksi yang menghalangi: update_status/cancel/reject dengan status
        // 'pending' atau 'syncing'. 'failed' dan 'orphaned_needs_review'
        // tidak menghalangi karena tidak akan dikirim lagi.
        const blocking = await pendingActionsCollection
          .query(
            Q.where('target_order_id', orderId),
            Q.where('action_type', Q.oneOf(['update_status', 'cancel', 'reject'])),
            Q.where('status', Q.oneOf(['pending', 'syncing'])),
          )
          .fetch();
        if (blocking.length > 0) continue;

        // Baris disiapkan sekali di bawah, setelah semua laporan dicek.
        rowsToRelease.add(orderId);

        // Aksi update_status, cancel, dan reject order ini dihapus, status apa
        // pun, sama seperti writeRejectConflictAndDelete untuk 'reassigned'.
        // collect_cod tidak disentuh. Kolom dibaca lewat _getRaw karena
        // dekorator @text tidak aktif di Jest.
        const allForOrder = await pendingActionsCollection
          .query(Q.where('target_order_id', orderId))
          .fetch();
        const deleteIds: string[] = [];
        for (const action of allForOrder) {
          const actionType = action._getRaw('action_type');
          if (actionType === 'collect_cod') continue;
          deleteIds.push(action.id);
        }
        if (deleteIds.length > 0) {
          actionsToDelete.set(orderId, deleteIds);
        }
      }

      // Tandai baris lepas: satu prepareUpdate per order, dengan
      // driver_id null, last_conflict_reason 'released', last_conflict_at,
      // _status 'synced', _changed ''. Status, versi, dan kolom lain tidak
      // diubah, karena driver lama tidak berhak tahu keadaan order sekarang.
      for (const orderId of rowsToRelease) {
        const row = await ordersCollection.find(orderId);
        const op = row.prepareUpdate((r) => {
          r._setRaw('driver_id', null);
          r._setRaw('last_conflict_reason', 'released');
          r._setRaw('last_conflict_at', Date.now());
          r._raw._status = 'synced';
          r._raw._changed = '';
        });
        batch.push(op);
        releasedMarkedCount += 1;
      }

      // Siapkan prepareDestroyPermanently untuk aksi-aksi yang akan dihapus.
      for (const orderId of rowsToRelease) {
        const deleteIds = actionsToDelete.get(orderId) ?? [];
        if (deleteIds.length === 0) continue;
        const actions = await pendingActionsCollection
          .query(Q.where('target_order_id', orderId))
          .fetch();
        for (const action of actions) {
          if (!deleteIds.includes(action.id)) continue;
          batch.push(action.prepareDestroyPermanently());
        }
      }

      for (const record of pull.records) {
        const collection = this.collectionFor(record.entityType, database);
        if (!collection) continue;

        // Laporannya sama atau lebih baru dari record ini (diputuskan di
        // atas), jadi record tidak dipakai.
        if (record.entityType === 'order' && skipRecordIds.has(record.id)) {
          continue;
        }

        if (record.deleted) {
          // Soft delete lokal, cari row, kalau ada, mark deleted_at
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
            // Versi order lokal tidak boleh turun: aksi outbox yang baru
            // sukses (misalnya update_status atau cancel) menulis
            // server_version dari respons, sedangkan pull yang datanya
            // diambil lebih dulu membawa versi lama. Kalau baris itu
            // tertimpa, aksi status berikutnya mengirim versi lama dan
            // ditolak VERSION_CONFLICT. Nilai lokal yang bukan angka tidak
            // dibandingkan, baris diperbarui.
            if (record.entityType === 'order') {
              const localVersion = existing._getRaw('server_version');
              if (typeof localVersion === 'number' && localVersion > record.serverVersion) {
                continue;
              }
            }
            batch.push(existing.prepareUpdate((r: any) => {
              this.applyServerDataToLocalRow(r, record);
              // Mark as synced agar tidak dianggap dirty di collectDirty() berikutnya
              r._raw._status = 'synced';
            }));
          } else {
            // Gunakan prepareCreateFromDirtyRaw + database.batch(), official
            // WatermelonDB API untuk record dengan custom ID (server UUID).
            // Pola lama (collection.prepareCreate + r._raw.id = record.id)
            // tidak didukung resmi WatermelonDB dan bisa bikin row korup.
            // Pola ini sudah dipakai di OrdersScreen fetchPool
            // dan outbox enqueue*, sekarang applyPull catch up.
            //
            // Field mapping parallel dengan applyServerDataToLocalRow (update
            // path). Lihat buildRawRowForCreate JSDoc untuk Decision rationale
            // kenapa dua function terpisah, bukan shared mapping spec.
            const preparedRecord = collection.prepareCreateFromDirtyRaw(
              this.buildRawRowForCreate(record),
            );
            batch.push(preparedRecord);
          }
        }
      }

      if (batch.length > 0) {
        await database.batch(...batch);
      }
    });

    // Cursor hanya disimpan kalau write benar-benar berjalan dan respons
    // membawa records, supaya pull dengan generasi lama atau respons
    // tanpa records tidak menyimpan cursor yang salah.
    if (writeApplied && pull.records.length > 0) {
      await saveCursor(pull.nextCursor);
    }

    // pool-refresh dipancarkan sekali kalau ada baris yang ditandai lepas
    // dan write benar-benar berjalan, supaya OrdersScreen mengambil ulang
    // daftar Tersedia.
    if (writeApplied && releasedMarkedCount > 0) {
      syncEvents.emit('pool-refresh', { source: 'released' });
    }
  }

  /**
   * Apply server data ke local WatermelonDB row.
   *
   * DATA MAPPING:
   * - snake_case DB columns -> camelCase domain types
   * - JSON string columns (items_json, address_json, attachment_json) -> parsed objects
   *   NOTE: @json decorator di OrderModel auto-parses on read & auto-stringifies on write
   *   DO NOT call JSON.stringify/JSON.parse manually, assign raw objects directly.
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
      // @json decorator auto-stringify on write, assign raw object
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
      // @json decorator auto-stringify on write, assign raw object
      row.attachmentJson = (d as any).attachment ?? null;
      row.status = (d as any).status;
      row.clientCreatedAt = new Date((d as any).clientCreatedAt).getTime();
      row.serverCreatedAt = (d as any).serverCreatedAt
        ? new Date((d as any).serverCreatedAt).getTime()
        : null;
    }
  }

  /**
   * Build dirty raw object untuk prepareCreateFromDirtyRaw() dari server
   * pull record. Mirror dari applyServerDataToLocalRow (update path) -
   * field mapping sama - tapi untuk create path dengan snake_case keys.
   *
   * Beda API antara dua path:
   * - Update path: `row.fooBar = value` (Model setter, camelCase)
   * - Create path: prepareCreateFromDirtyRaw accepts raw row shape dengan
   *   snake_case column names + reserved keys (`id`, `_status`, `_changed`)
   *
   * Kenapa snake_case: prepareCreateFromDirtyRaw memakai sanitizedRaw.
   * WatermelonDB mengiterasi tableSchema.columnArray dan hanya menyalin
   * kunci yang sama persis dengan nama kolom. Kunci lain (mis. camelCase)
   * di-drop, dan kolom yang tidak dikirim jatuh ke nilai bawaan ('' untuk
   * string wajib, 0 untuk number wajib, null untuk kolom opsional).
   *
   * Kolom JSON (items_json, address_json, attachment_json) harus dikirim
   * sebagai string JSON. Nilai bukan string di kolom string juga diganti
   * nilai bawaan, jadi object harus di-JSON.stringify dulu.
   *
   * record.data bertipe union Order | Payment | ChatMessage dan
   * entityType ada di luar data, jadi TypeScript tidak bisa mempersempit
   * sendiri; cast per cabang di bawah dijaga oleh pengecekan entityType.
   *
   * created_at dan updated_at tidak diisi otomatis oleh
   * prepareCreateFromDirtyRaw, jadi keduanya dikirim eksplisit di sini:
   * created_at dari server (`data.createdAt`, parsed ke ms) atau fallback
   * Date.now(); updated_at selalu Date.now() (waktu persist lokal).
   *
   * Function terpisah dari applyServerDataToLocalRow karena dua API ini
   * secara struktural berbeda (Model setter vs raw object API). Shared
   * mapping spec bakal encode dua konvensi sekaligus tanpa benar-benar
   * mengurangi duplication. Code reviewer bisa langsung compare dua
   * function side-by-side di file ini untuk catch drift kalau field
   * mapping server berubah.
   */
  private buildRawRowForCreate(record: SyncRecordPull): Record<string, unknown> {
    const d = record.data;
    const now = Date.now();
    const createdAtRaw = parseIsoMsOrNull(d.createdAt) ?? now;
    const updatedAtRaw = now;

    // Pulled dari server, bukan perubahan user - langsung synced,
    // gak akan di-pickup oleh collectDirty() berikutnya.
    const base: Record<string, unknown> = {
      id: record.id,
      _status: 'synced',
      _changed: '',
      server_version: record.serverVersion,
      created_at: createdAtRaw,
      updated_at: updatedAtRaw,
    };

    if (record.entityType === 'order') {
      const orderData = d as Order;
      return {
        ...base,
        customer_id: orderData.customerId,
        driver_id: orderData.driverId ?? null,
        status: orderData.status,
        items_json: JSON.stringify(orderData.items),
        address_json: JSON.stringify(orderData.deliveryAddress),
        total_cents: orderData.totalCents,
        currency: orderData.currency,
        notes: orderData.notes ?? null,
        cancelled_by: orderData.cancelledBy ?? null,
        cancel_reason: orderData.cancelReason ?? null,
      };
    } else if (record.entityType === 'payment') {
      const paymentData = d as Payment;
      return {
        ...base,
        order_id: paymentData.orderId,
        idempotency_key: paymentData.idempotencyKey,
        method: paymentData.method,
        status: paymentData.status,
        amount_cents: paymentData.amountCents,
        currency: paymentData.currency,
        kind: paymentData.kind,
        external_ref: paymentData.externalRef ?? null,
      };
    } else if (record.entityType === 'chat_message') {
      const chatData = d as ChatMessage;
      return {
        ...base,
        room_id: chatData.roomId,
        sender_id: chatData.senderId,
        body: chatData.body,
        attachment_json: chatData.attachment != null ? JSON.stringify(chatData.attachment) : null,
        status: chatData.status,
        // Kolom angka wajib di schema (bukan optional); 0 bukan timestamp yang sah,
        // jadi fallback ke now saat server tidak kirim atau ISO string tidak valid.
        client_created_at: parseIsoMsOrNull(chatData.clientCreatedAt) ?? now,
        server_created_at: parseIsoMsOrNull(chatData.serverCreatedAt),
      };
    }

    return base;
  }

  // ============ collectDirty ============

  private async collectDirty(db: Database): Promise<SyncPushPayload> {
    const deviceId = await getDeviceId();
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Not authenticated, cannot sync without login');
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
        // Skip rows yang sudah melewati retry cap, resolveAcks() sudah
        // tandai mereka FAILED_SYNC dan increment failedSyncAttempts.
        // Mereka tidak akan pernah disinkronkan ulang, menghindari
        // silent retry storm.
        const raw = (row as any)._raw;
        const attempts = (row as any).failedSyncAttempts ?? 0;
        if (attempts >= MAX_SYNC_ATTEMPTS) {
          console.warn(
            `[collectDirty] Skipping ${colName}: id=${row.id}, hit retry cap (${attempts}/${MAX_SYNC_ATTEMPTS})`,
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
        // @json decorator auto-parse on read, use directly
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
        // Do NOT writeback to the row here, collectDirty() is called from
        // concurrent sync paths and writeback during read phase is racy.
        // The next legitimate edit to this row (or another sync cycle) will
        // re-trigger this fallback, which is acceptable for the recovery path.
        const fallbackKey = `cod:${reactNativeUUID.v4()}`;
        console.warn(
          `[localRowToSyncRecord] payment row ${row.id} missing idempotencyKey, ` +
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
        // @json decorator auto-parse on read, use directly
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
   * ack was lost, second push gets existing-server-id as ack.id" case.
   */
  private async findLocalPaymentByAck(
    collection: any,
    ack: SyncPushResponse['acks'][number],
  ): Promise<any | null> {
    // First try by ack.id (fast path)
    const byId = await collection.find(ack.id).catch(() => null);
    if (byId) return byId;

    // Fallback: match by idempotencyKey from serverData (payment-specific)
    if (ack.entityType !== 'payment' || !(ack.serverData as Payment)?.idempotencyKey) {
      return null;
    }
    const idempotencyKey = (ack.serverData as Payment).idempotencyKey;
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
            // currentUserId hanya dibutuhkan untuk deteksi order di-accept
            // oleh driver lain (orderRemovedFromView). Tidak lagi di-hoist
            // untuk prepareUpdate callback, Temuan 1: cancel-offline
            // discriminator sudah dipindah ke outbox.ts handleVersionConflict.
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
            // Flip domain status: chat_message jadi SENT, payment jadi CAPTURED
            // Ini fix C3, tanpa ini, pesan chat sync-path tampil 'mengirim...'
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
        // After hitting the cap, stop collecting, avoids infinite retry storms.
        const collection = this.collectionFor(ack.entityType, db);
        if (!collection) continue;

        const existing = await collection.find(ack.id).catch(() => null);
        if (existing) {
          const currentAttempts = (existing as any).failedSyncAttempts ?? 0;
          const nextAttempts = currentAttempts + 1;

          batch.push(existing.prepareUpdate((r: any) => {
            r.failedSyncAttempts = nextAttempts;
            // Order yang ditolak sampai batas diberi last_conflict_reason
            // 'sync-rejected' supaya driver melihat bannernya. _status dan
            // _changed tidak diubah: baris ini memang kotor, dan setelah batas
            // tidak diambil collectDirty lagi.
            if (ack.entityType === 'order' && nextAttempts >= MAX_SYNC_ATTEMPTS) {
              r._setRaw('last_conflict_reason', 'sync-rejected');
              r._setRaw('last_conflict_at', Date.now());
            }
            // For chat messages and payments, flip domain status to FAILED so UI can surface it
            // Orders do NOT have a FAILED domain status, no status flip for orders
            if ((ack.entityType === 'chat_message' || ack.entityType === 'payment') && nextAttempts >= MAX_SYNC_ATTEMPTS) {
              (r as any).status = 'FAILED';
              console.error(
                `[resolveAcks] Record permanently rejected after ${MAX_SYNC_ATTEMPTS} attempts, ${ack.entityType} id=${ack.id} marked FAILED. ` +
                `User should be notified. Server reason: ${ack.reason ?? 'unknown'}`,
              );
            } else if (nextAttempts >= MAX_SYNC_ATTEMPTS) {
              console.error(
                `[resolveAcks] Record permanently rejected after ${MAX_SYNC_ATTEMPTS} attempts, ${ack.entityType} id=${ack.id}. ` +
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
