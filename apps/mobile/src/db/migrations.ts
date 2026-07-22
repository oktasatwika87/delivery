import { schemaMigrations, createTable, addColumns } from '@nozbe/watermelondb/Schema/migrations';

/**
 * WatermelonDB schema migrations.
 *
 * v1 -> v2: Buat tabel users, tambah idempotency_key ke payments
 * v2 -> v3: Tambah created_at & updated_at ke semua tabel
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
  ],
});
