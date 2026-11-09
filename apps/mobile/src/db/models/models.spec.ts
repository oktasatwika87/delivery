/**
 * Tes dekorator model WatermelonDB.
 *
 * Accessor dekorator (@text, @json, @date) ada di prototype kelas model.
 * Kalau kompilasi menulis field kelas sendiri, field instance itu menutupi
 * accessor prototype: getter jadi undefined dan setter tidak menulis ke _raw.
 * Tes ini memastikan accessor tetap dipakai, sama seperti di aplikasi.
 *
 * Database LokiJS di memori dengan skema dan kelas model asli.
 * Jalankan dengan --forceExit (timer simpan otomatis Loki).
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { schema } from '../schema';
import { ChatMessageModel } from './ChatMessageModel';
import { OrderModel } from './OrderModel';

// database Loki asli, sinkron, di memori (pola sama dengan spec OrdersScreen)
function buildTestDatabase(): Database {
  const adapter = new LokiJSAdapter({
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    onSetUpError: (e: Error) => {
      throw e;
    },
  });
  return new Database({
    adapter,
    modelClasses: [ChatMessageModel, OrderModel],
  });
}

describe('dekorator model WatermelonDB', () => {
  let db: Database;

  beforeEach(() => {
    db = buildTestDatabase();
  });

  describe('ChatMessageModel', () => {
    it('kolom yang diisi lewat setter masuk ke _raw dan terbaca lewat getter', async () => {
      let id = '';

      await db.write(async () => {
        const baris = await db.get<ChatMessageModel>('chat_messages').create((m) => {
          m.roomId = 'room-1';
          m.senderId = 'user-1';
          m.body = 'halo';
          m.status = 'PENDING_SEND';
          m.clientCreatedAt = 1_700_000_000_000;
          m.serverVersion = 3;
        });
        id = baris.id;
      });

      // baris diambil ulang dari database, bukan objek yang tadi dibuat
      const baris = await db.get<ChatMessageModel>('chat_messages').find(id);

      expect(baris.roomId).toBe('room-1');
      expect(baris.senderId).toBe('user-1');
      expect(baris.body).toBe('halo');
      expect(baris.status).toBe('PENDING_SEND');
      expect(baris.status).toBe(baris._getRaw('status'));
      expect(baris._getRaw('room_id')).toBe('room-1');
      expect(baris._getRaw('body')).toBe('halo');

      // accessor ada di prototype, jadi baris sendiri tidak punya field status
      expect(Object.prototype.hasOwnProperty.call(baris, 'status')).toBe(false);
    });

    it('status yang diubah lewat update ikut berubah di _raw', async () => {
      let id = '';

      await db.write(async () => {
        const baris = await db.get<ChatMessageModel>('chat_messages').create((m) => {
          m.roomId = 'room-1';
          m.senderId = 'user-1';
          m.body = 'halo';
          m.status = 'PENDING_SEND';
          m.clientCreatedAt = 1_700_000_000_000;
          m.serverVersion = 3;
        });
        id = baris.id;
      });

      const baris = await db.get<ChatMessageModel>('chat_messages').find(id);
      await db.write(async () => {
        await baris.update((m) => {
          m.status = 'SENT';
        });
      });

      expect(baris._getRaw('status')).toBe('SENT');

      const ulang = await db.get<ChatMessageModel>('chat_messages').find(id);
      expect(ulang._getRaw('status')).toBe('SENT');
      expect(ulang.status).toBe('SENT');
    });
  });

  describe('OrderModel', () => {
    it('itemsJson diisi array lewat setter, tersimpan sebagai teks JSON, dan terbaca lagi sebagai array', async () => {
      const items = [
        { id: 'item-1', name: 'Nasi Goreng', quantity: 2 },
        { id: 'item-2', name: 'Es Teh', quantity: 1 },
      ];
      let id = '';

      await db.write(async () => {
        const baris = await db.get<OrderModel>('orders').create((m) => {
          m.customerId = 'cust-1';
          m.status = 'ASSIGNED';
          m.itemsJson = items;
          m.addressJson = { city: 'Badung' };
          m.totalCents = 33_000;
          m.currency = 'IDR';
          m.serverVersion = 1;
        });
        id = baris.id;
      });

      const baris = await db.get<OrderModel>('orders').find(id);

      expect(baris._getRaw('items_json')).toBe(JSON.stringify(items));
      expect(baris.itemsJson).toEqual(items);
    });

    it('createdAt dibaca sebagai Date yang nilainya sama dengan _raw.created_at', async () => {
      let id = '';

      await db.write(async () => {
        const baris = await db.get<OrderModel>('orders').create((m) => {
          m.customerId = 'cust-1';
          m.status = 'ASSIGNED';
          m.itemsJson = [];
          m.addressJson = { city: 'Badung' };
          m.totalCents = 10_000;
          m.currency = 'IDR';
          m.serverVersion = 1;
        });
        id = baris.id;
      });

      const baris = await db.get<OrderModel>('orders').find(id);

      expect(baris.createdAt).toBeInstanceOf(Date);
      expect(baris.createdAt.getTime()).toBe(baris._getRaw('created_at'));
    });
  });
});
