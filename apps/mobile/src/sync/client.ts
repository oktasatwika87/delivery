/**
 * HTTP client ke backend.
 * Stub — tinggal pasang fetch + auth token dari secure-store.
 */

import Config from 'react-native-config';
import type { SyncPushPayload, SyncPushResponse, SyncPullResponse } from '@delivery/shared';
import { getCurrentToken } from './session';

/** Base URL API dari .env (react-native-config) */
const API_BASE = Config.API_BASE_URL;

/** Build fetch options dengan Authorization header jika ada token */
async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getCurrentToken();
  console.log('[fetchWithAuth] Token:', token ? `Bearer ${token.substring(0, 20)}...` : 'NULL');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string>),
  };
  return fetch(url, { ...options, headers });
}

export async function pushBatch(payload: SyncPushPayload): Promise<SyncPushResponse> {
  // AbortController: timeout 8 detik — fail fast kalau network unreachable
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetchWithAuth(`${API_BASE}/sync/push`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) throw new Error(`pushBatch failed: ${res.status}`);
    return res.json() as Promise<SyncPushResponse>;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('[pushBatch] Request aborted due to 8s timeout — offline-first continues');
      // Return empty response so sync can retry later
      return { acks: [], pullDelta: undefined };
    }
    throw err;
  }
}

export async function pullBatch(deviceId: string, cursor: string | null): Promise<SyncPullResponse> {
  // Build query string manually — URL/URLSearchParams not available in React Native
  let queryString = `deviceId=${encodeURIComponent(deviceId)}`;
  if (cursor) {
    queryString += `&since=${encodeURIComponent(cursor)}`;
  }
  const url = `${API_BASE}/sync/pull?${queryString}`;

  // AbortController: timeout 8 detik — fail fast kalau network unreachable.
  // Offline-first UX: tidak ada spinner 2 menit, langsung continue tanpa data.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetchWithAuth(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) throw new Error(`pullBatch failed: ${res.status}`);
    return res.json() as Promise<SyncPullResponse>;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('[pullBatch] Request aborted due to 8s timeout — offline-first continues');
      // Return empty response so sync continues gracefully
      return { nextCursor: null, records: [], serverTime: new Date().toISOString() };
    }
    throw err;
  }
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

/** Error yang dilempar saat session expired (bukan wrong credentials). */
export class UnauthorizedError extends Error {
  constructor(message: string = 'Sesi berakhir, silakan login ulang') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export interface AvailableOrderItem {
  orderId: string;
  totalCents: number;
  currency: string;
  itemsCount: number;
  city?: string;
  createdAt: string;
  /** Server version untuk OCC baseVersion saat driver accept (sync push). */
  version: number;
}

/**
 * Ambil daftar order yang tersedia di driver pool.
 * AbortController 8 detik — fail fast kalau network unreachable.
 */
export async function fetchAvailableOrders(take?: number): Promise<AvailableOrderItem[]> {
  let url = `${API_BASE}/orders/available`;
  if (take !== undefined) {
    url += `?take=${String(take)}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetchWithAuth(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) throw new Error(`fetchAvailableOrders failed: ${res.status}`);
    return res.json() as Promise<AvailableOrderItem[]>;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('[fetchAvailableOrders] Request aborted due to 8s timeout — returning empty');
      return [];
    }
    throw err;
  }
}

// ─── Chat ─────────────────────────────────────────────────────────────────

export interface SendMessagePayload {
  /** Client-generated UUID — consistent ID across devices. */
  id: string;
  roomId: string;
  body: string;
  attachment?: Record<string, unknown>;
  clientCreatedAt: string; // ISO string
}

export interface SendMessageResponse {
  id: string;
  roomId: string;
  senderId: string;
  body: string;
  attachment?: Record<string, unknown>;
  status: string;
  clientCreatedAt: string;
  serverCreatedAt: string;
  version: number;
}

/**
 * Kirim pesan chat via REST.
 * Dipanggil setelah pesan dibuat lokal (offline-first — pesan sudah tampil di UI).
 */
export async function sendChatMessage(
  payload: SendMessagePayload
): Promise<SendMessageResponse> {
  console.log('[sendChatMessage] Payload:', JSON.stringify(payload));
  const res = await fetchWithAuth(`${API_BASE}/chat/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (res.status === 401) {
    throw new UnauthorizedError();
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`[sendChatMessage] Failed: status=${res.status}, body=${body}`);
    throw new Error(`sendChatMessage failed: ${res.status} - ${body}`);
  }

  const response = await res.json();
  console.log('[sendChatMessage] Success:', JSON.stringify(response));
  return response as Promise<SendMessageResponse>;
}
