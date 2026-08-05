import { schemaMigrations, createTable, addColumns } from '@nozbe/watermelondb/Schema/migrations';

/**
 * WatermelonDB schema migrations.
 *
 * v1 -> v2: Buat tabel users, tambah idempotency_key ke payments
 * v2 -> v3: Tambah created_at & updated_at ke semua tabel
 * v3 -> v4: Tambah tabel route_snapshots (offline-first route cache)
 * v4 -> v5: Tambah failed_sync_attempts ke orders/payments/chat_messages
 *           (cap retry agar record yang gagal sync tidak stuck retry forever)
 */
export const watermelonMigrations = schemaMigrations({
  migrations: [
    // v1 -> v2
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
    // v2 -> v3: created_at & updated_at ke semua tabel
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
    // v3 -> v4: tambah tabel route_snapshots (cache rute terakhir).
    // LRU max 20 entry — lihat src/map/routeSnapshot.ts.
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
    // v4 -> v5: failed_sync_attempts — cap retry pada record yang gagal
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
  ],
});
