/**
 * WatermelonDB schema.
 *
 * Penting: bump versi + tambahkan migration saat kolom baru.
 */

import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 8,
  tables: [
    tableSchema({
      name: 'users',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'phone', type: 'string' },
        { name: 'role', type: 'string' },
        { name: 'server_version', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'orders',
      columns: [
        { name: 'customer_id', type: 'string', isIndexed: true },
        { name: 'driver_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'items_json', type: 'string' },
        { name: 'address_json', type: 'string' },
        { name: 'total_cents', type: 'number' },
        { name: 'currency', type: 'string' },
        { name: 'notes', type: 'string', isOptional: true },
        { name: 'server_version', type: 'number' },
        { name: 'deleted_at', type: 'number', isOptional: true },
        { name: 'failed_sync_attempts', type: 'number' },
        { name: 'cancelled_by', type: 'string', isOptional: true },
        { name: 'cancel_reason', type: 'string', isOptional: true },
        // v8, Skenario A: persisted banner signal untuk cancel-offline conflict
        { name: 'last_conflict_reason', type: 'string', isOptional: true },
        { name: 'last_conflict_at', type: 'number', isOptional: true, isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'payments',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        { name: 'idempotency_key', type: 'string' },
        { name: 'method', type: 'string' },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'amount_cents', type: 'number' },
        { name: 'currency', type: 'string' },
        { name: 'kind', type: 'string' },
        { name: 'external_ref', type: 'string', isOptional: true },
        { name: 'server_version', type: 'number' },
        { name: 'deleted_at', type: 'number', isOptional: true },
        { name: 'failed_sync_attempts', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'chat_messages',
      columns: [
        { name: 'room_id', type: 'string', isIndexed: true },
        { name: 'sender_id', type: 'string' },
        { name: 'body', type: 'string' },
        { name: 'attachment_json', type: 'string', isOptional: true },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'client_created_at', type: 'number' },
        { name: 'server_created_at', type: 'number', isOptional: true },
        { name: 'server_version', type: 'number' },
        { name: 'deleted_at', type: 'number', isOptional: true },
        { name: 'failed_sync_attempts', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    // v4, route_snapshots: cache rute terakhir untuk fallback offline-first
    // ketika routing API tidak bisa di-fetch (offline).
    tableSchema({
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
    // v7, pending_actions: outbox untuk offline-first driver actions
    // (reject, cancel, collect_cod). Diproses FIFO saat device online.
    tableSchema({
      name: 'pending_actions',
      columns: [
        { name: 'action_type', type: 'string', isIndexed: true },
        { name: 'target_order_id', type: 'string', isIndexed: true },
        { name: 'expected_version', type: 'number' },
        { name: 'idempotency_key', type: 'string' },
        { name: 'payload_json', type: 'string', isOptional: true },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});