/**
 * HTTP client ke backend.
 * Stub — tinggal pasang fetch + auth token dari secure-store.
 */

import Config from 'react-native-config';
import type { SyncPushPayload, SyncPushResponse, SyncPullResponse } from '@delivery/shared';

/** Base URL API dari .env (react-native-config) */
const API_BASE = Config.API_BASE_URL;

export async function pushBatch(payload: SyncPushPayload): Promise<SyncPushResponse> {
  const res = await fetch(`${API_BASE}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`pushBatch failed: ${res.status}`);
  return res.json() as Promise<SyncPushResponse>;
}

export async function pullBatch(deviceId: string, cursor: string | null): Promise<SyncPullResponse> {
  const url = new URL(`${API_BASE}/sync/pull`);
  url.searchParams.set('deviceId', deviceId);
  if (cursor) url.searchParams.set('since', cursor);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`pullBatch failed: ${res.status}`);
  return res.json() as Promise<SyncPullResponse>;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    role: string;
    name: string;
    phone: string;
  };
}

/**
 * Login ke backend.
 *
 * throws InvalidCredentialsError kalau phone/password salah.
 */
export async function login(phone: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });

  if (res.status === 401) {
    throw new InvalidCredentialsError('Nomor atau password salah');
  }

  if (!res.ok) {
    throw new Error(`Login failed: ${res.status}`);
  }

  return res.json() as Promise<LoginResponse>;
}

/** Error yang dilempar saat login gagal karena credentials salah. */
export class InvalidCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCredentialsError';
  }
}