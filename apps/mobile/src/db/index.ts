/**
 * WatermelonDB instance.
 *
 * Skema didefinisikan di src/db/schema.ts; models di src/db/models/.
 * Adapter SQLite di native, JSI diaktifkan untuk perf.
 */

import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import { schema } from './schema';
import { watermelonMigrations } from './migrations';
import { OrderModel } from './models/OrderModel';
import { PaymentModel } from './models/PaymentModel';
import { ChatMessageModel } from './models/ChatMessageModel';
import { UserModel } from './models/UserModel';
import { RouteSnapshotModel } from './models/RouteSnapshotModel';
import { PendingActionModel } from './models/PendingActionModel';

const adapter = new SQLiteAdapter({
  schema,
  migrations: watermelonMigrations,
  // JSI memberi ~2-5x speedup untuk sync heavy ops.
  jsi: true,
  dbName: 'delivery',
  // Backup untuk debug
  onSetUpError: (error) => {
    console.error('[db] setup failed', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [UserModel, OrderModel, PaymentModel, ChatMessageModel, RouteSnapshotModel, PendingActionModel],
});
