/**
 * Data lokal per akun.
 *
 * DB lokal berisi data dari satu akun pemilik. Akun lain hanya boleh
 * masuk setelah data lokal dibersihkan, dan pembersihan hanya boleh
 * kalau tidak ada data yang belum terkirim.
 *
 * Pemilik disimpan di AsyncStorage dengan kunci `local_data_owner`.
 * Bila pemilik sama dengan akun yang sedang login, sesi langsung aktif.
 * Bila beda atau kosong, ada dua jalur:
 * - Ada data belum terkirim (>0): login ditolak dengan pesan.
 * - Tidak ada data: clearLocalData() + setLocalDataOwner(userId), token
 *   disimpan, sesi aktif.
 *
 * Aksi 'orphaned_needs_review' dan pesan chat yang sudah mencapai batas
 * percobaan tidak dihitung; mereka tidak akan pernah terkirim lagi
 * otomatis. Batas 5 sama dengan MAX_SYNC_ATTEMPTS di coordinator.ts;
 * dengan sinkron berkala tiap 30 detik, batas itu tercapai sekitar
 * 2,5 menit.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Q } from '@nozbe/watermelondb';
import type { Database, Model } from '@nozbe/watermelondb';
import { saveCursor } from './cursor';
import { saveToken } from './token-storage';

const OWNER_KEY = 'local_data_owner';

/**
 * Batas jumlah percobaan sync sebelum pesan chat ditandai dan tidak lagi
 * dihitung untuk blokir login. Dicerminkan dari MAX_SYNC_ATTEMPTS di
 * coordinator.ts (5). Konstanta ditulis ulang di sini agar modul ini
 * tidak mengimpor coordinator.ts.
 */
const MAX_FAILED_SYNC_ATTEMPTS = 5;

export async function getLocalDataOwner(): Promise<string | null> {
  const stored = await AsyncStorage.getItem(OWNER_KEY);
  return stored && stored.length > 0 ? stored : null;
}

export async function setLocalDataOwner(userId: string | null): Promise<void> {
  if (userId === null) {
    await AsyncStorage.removeItem(OWNER_KEY);
  } else {
    await AsyncStorage.setItem(OWNER_KEY, userId);
  }
}

/**
 * Hitung baris yang akan dikirim otomatis (belum terkirim). Pemeriksaan
 * lewat `Q.where` dan `fetchCount()`, bukan getter model, supaya bisa
 * dites dengan LokiJS (dekorator model tidak aktif di Jest).
 *
 * Dihitung:
 * - pending_actions berstatus 'pending', 'syncing', atau 'failed'
 * - chat_messages dengan _status 'created' atau 'updated' dan
 *   failed_sync_attempts < MAX_FAILED_SYNC_ATTEMPTS
 *
 * Tidak dihitung:
 * - pending_actions berstatus 'orphaned_needs_review' (sudah mencapai
 *   batas percobaan, tidak akan terkirim otomatis)
 * - chat_messages dengan _status 'created'/'updated' tapi sudah
 *   gagal >= MAX_FAILED_SYNC_ATTEMPTS kali
 * - chat_messages dengan _status 'synced' (sudah terkirim)
 * - order/payment kotor (push order/payment dari app selalu ditolak
 *   server, sehingga tidak relevan untuk pemblokiran login)
 */
export async function countUnsentData(db: Database): Promise<number> {
  const pendingCollection = db.get('pending_actions');
  const pendingCount = await pendingCollection
    .query(
      Q.where('status', Q.oneOf(['pending', 'syncing', 'failed'])),
    )
    .fetchCount();

  const chatCollection = db.get('chat_messages');
  const chatCount = await chatCollection
    .query(
      Q.where('_status', Q.oneOf(['created', 'updated'])),
      Q.where('failed_sync_attempts', Q.lt(MAX_FAILED_SYNC_ATTEMPTS)),
    )
    .fetchCount();

  return pendingCount + chatCount;
}

/**
 * Hapus semua baris di keenam tabel dalam satu database.write
 * berisi satu batch. Semua baris dihapus permanen dengan
 * `prepareDestroyPermanently()`.
 *
 * Dipakai oleh startLocalSession (saat pemilik berubah) dan
 * clearLocalDataForLogout (saat pengguna keluar). Tidak mengubah kursor
 * atau pemilik; tanggung jawab pemanggil.
 */
export async function clearLocalData(db: Database): Promise<void> {
  await db.write(async () => {
    const tables: ReadonlyArray<string> = [
      'users',
      'orders',
      'payments',
      'chat_messages',
      'route_snapshots',
      'pending_actions',
    ];
    const batch: Array<ReturnType<Model['prepareDestroyPermanently']>> = [];
    for (const tableName of tables) {
      const collection = db.get(tableName);
      const rows = await collection.query().fetch();
      for (const row of rows) {
        batch.push(row.prepareDestroyPermanently());
      }
    }
    if (batch.length > 0) {
      await db.batch(...batch);
    }
  });
}

/**
 * Mulai sesi lokal untuk akun baru.
 *
 * - Pemilik sudah cocok: `saveToken(token, userId)`, `{ ok: true }`.
 * - Pemilik beda/kosong, tidak ada data belum terkirim:
 *   berurutan `saveCursor(null)`, `clearLocalData(db)`,
 *   `setLocalDataOwner(userId)`, `saveToken(token, userId)`.
 *   Urutan: kursor dikosongkan sebelum DB dibersihkan (kalau putus
 *   di tengah, pull berikutnya membaca dari awal dan penuh), dan
 *   pemilik baru ditulis setelah DB bersih dan sebelum token (token
 *   akun baru tidak pernah ada bersama data akun lain).
 * - Pemilik beda/kosong, ada data belum terkirim:
 *   `{ ok: false, unsentCount }`. Token TIDAK disimpan sehingga
 *   tidak terjadi percampuran akun.
 */
export type StartLocalSessionResult =
  | { ok: true }
  | { ok: false; unsentCount: number };

export async function startLocalSession(
  token: string,
  userId: string,
  db: Database,
): Promise<StartLocalSessionResult> {
  const currentOwner = await getLocalDataOwner();
  if (currentOwner === userId) {
    await saveToken(token, userId);
    return { ok: true };
  }

  const unsentCount = await countUnsentData(db);
  if (unsentCount > 0) {
    return { ok: false, unsentCount };
  }

  await saveCursor(null);
  await clearLocalData(db);
  await setLocalDataOwner(userId);
  await saveToken(token, userId);
  return { ok: true };
}

/**
 * Bersihkan data lokal saat pengguna keluar dari akun. Berurutan
 * `saveCursor(null)`, `clearLocalData(db)`, `setLocalDataOwner(null)`.
 *
 * Dipakai handleLogout di App.tsx, hanya kalau tidak ada data yang
 * belum terkirim.
 */
export async function clearLocalDataForLogout(db: Database): Promise<void> {
  await saveCursor(null);
  await clearLocalData(db);
  await setLocalDataOwner(null);
}

/**
 * Pesan untuk pengguna saat masuk atau daftar ditolak karena masih ada
 * data yang belum terkirim. Jumlahnya ikut ditampilkan.
 */
export function unsentDataBlockMessage(count: number): string {
  return `HP ini masih menyimpan ${count} data dari akun yang terakhir masuk, dan data itu belum terkirim. Masuk dulu dengan akun itu sampai datanya terkirim, lalu keluar dari akun itu.`;
}