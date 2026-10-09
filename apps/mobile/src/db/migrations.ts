import { schemaMigrations, createTable, addColumns } from '@nozbe/watermelondb/Schema/migrations';

/**
 * WatermelonDB schema migrations.
 *
 * v1 ke v2: Buat tabel users, tambah idempotency_key ke payments
 * v2 ke v3: Tambah created_at & updated_at ke semua tabel
 * v3 ke v4: Tambah tabel route_snapshots (offline-first route cache)
 * v4 ke v5: Tambah failed_sync_attempts ke orders/payments/chat_messages
 *           (cap retry agar record yang gagal sync tidak stuck retry forever)
 * v5 ke v6: Tambah cancelled_by & cancel_reason ke orders (cancel offline)
 * v6 ke v7: Tambah tabel pending_actions (offline-first driver actions outbox)
 * v7 ke v8: Tambah last_conflict_reason & last_conflict_at ke orders
 *           (Skenario A, persisted banner signal untuk cancel-offline
 *           conflict, survive app restart)
 */
export const watermelonMigrations = schemaMigrations({
  migrations: [
    // v1 ke v2
    {
      toVersion: 2,
      steps: [
        createTable({
          name: 'users',
          columns: [
            { name: 'name', type: 'string' },
            { name: 'phone', type: 'string' },
            { name: 'role', type: 'string' },
            { name: 'server_version', type: 'number' },
          ],
        }),
        addColumns({
          table: 'payments',
          columns: [{ name: 'idempotency_key', type: 'string' }],
        }),
      ],
    },
    // v2 ke v3: created_at & updated_at ke semua tabel
    {
      toVersion: 3,
      steps: [
        addColumns({
          table: 'users',
          columns: [
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        addColumns({
          table: 'orders',
          columns: [
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        addColumns({
          table: 'payments',
          columns: [
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        addColumns({
          table: 'chat_messages',
          columns: [
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    // v3 ke v4: tambah tabel route_snapshots (cache rute terakhir).
    // LRU max 20 entry, lihat src/map/routeSnapshot.ts.
    {
      toVersion: 4,
      steps: [
        createTable({
          name: 'route_snapshots',
          columns: [
            { name: 'origin_lat', type: 'string' },
            { name: 'origin_lng', type: 'string' },
            { name: 'dest_lat', type: 'string' },
            { name: 'dest_lng', type: 'string' },
            { name: 'geometry_json', type: 'string' },
            { name: 'fetched_at', type: 'number', isIndexed: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    // v4 ke v5: failed_sync_attempts, cap retry pada record yang gagal
    // sync. Tanpa kolom ini, record yang dikirim sebagai create tapi
    // diterima sebagai rejected (e.g. server validation error) akan
    // stuck retry selamanya di sync coordinator.
    {
      toVersion: 5,
      steps: [
        addColumns({
          table: 'orders',
          columns: [{ name: 'failed_sync_attempts', type: 'number' }],
        }),
        addColumns({
          table: 'payments',
          columns: [{ name: 'failed_sync_attempts', type: 'number' }],
        }),
        addColumns({
          table: 'chat_messages',
          columns: [{ name: 'failed_sync_attempts', type: 'number' }],
        }),
      ],
    },
    // v5 ke v6: cancelled_by & cancel_reason, track siapa yang cancel
    // dan alasannya. Dipakai untuk offline cancel order flow.
    {
      toVersion: 6,
      steps: [
        addColumns({
          table: 'orders',
          columns: [
            { name: 'cancelled_by', type: 'string', isOptional: true },
            { name: 'cancel_reason', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    // v6 ke v7: pending_actions, outbox untuk offline-first driver actions
    // (reject, cancel, collect_cod). Diproses FIFO saat device online.
    {
      toVersion: 7,
      steps: [
        createTable({
          name: 'pending_actions',
          columns: [
            { name: 'action_type', type: 'string' },
            { name: 'target_order_id', type: 'string' },
            { name: 'expected_version', type: 'number' },
            { name: 'idempotency_key', type: 'string' },
            { name: 'payload_json', type: 'string', isOptional: true },
            { name: 'status', type: 'string' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    // v7 ke v8: last_conflict_reason & last_conflict_at, persisted UI signal
    // untuk Skenario A (cancel-offline-vs-server-changed). Saat resolveAcks()
    // dapat 'conflict' ack dari server untuk record dengan pre-overwrite
    // status='CANCELLED', tulis reason + timestamp ke 2 field ini. BannerC
    // di OrderDetailScreen render berdasarkan field ini, survive app restart,
    // auto-expire 24 jam atau manual dismiss.
    {
      toVersion: 8,
      steps: [
        addColumns({
          table: 'orders',
          columns: [
            { name: 'last_conflict_reason', type: 'string', isOptional: true },
            { name: 'last_conflict_at', type: 'number', isOptional: true, isIndexed: true },
          ],
        }),
      ],
    },
  ],
});
