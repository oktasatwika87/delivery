/**
 * HTTP client ke backend.
 * Stub — tinggal pasang fetch + auth token dari secure-store.
 */

import Config from 'react-native-config';
import type { SyncPushPayload, SyncPushResponse, SyncPullResponse } from '@delivery/shared';
import { getCurrentToken } from './session';
import type { CreateOrderInput, Order, OrderStatus } from '@delivery/shared';

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

/** Register request payload */
export interface RegisterRequest {
  phone: string;
  password: string;
  name: string;
  role: 'CUSTOMER' | 'DRIVER';
}

/**
 * Register akun baru ke backend.
 *
 * throws RegisterError kalau registration gagal.
 */
export async function register(dto: RegisterRequest): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new RegisterError(`Registration failed: ${res.status} - ${errorBody}`);
  }

  return res.json() as Promise<LoginResponse>;
}

/** Error yang dilempar saat registration gagal. */
export class RegisterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegisterError';
  }
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

/**
 * Error generic dari API call non-2xx (selain 401 Unauthorized).
 *
 * Field `status` = HTTP status code, `code` = machine-readable code dari
 * backend (mis. `'VERSION_CONFLICT'`), `body` = parsed response body
 * (object kalau JSON, string kalau body plain text).
 *
 * Pesan Error tetap dalam format lama (`<prefix> failed: <status> - <body>`)
 * supaya log existing tetap kebaca. Mobile callers yang butuh branching
 * pakai `err.code` atau `err.status` — JANGAN parse pesan.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  body?: unknown;

  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/**
 * Parse error response body & build ApiError untuk non-2xx response.
 * Try JSON parse first, fallback ke plain text. Extract field `code`
 * kalau ada di parsed object.
 */
async function buildApiError(prefix: string, res: Response): Promise<ApiError> {
  const rawText = await res.text();
  let body: unknown = rawText;
  let code: string | undefined;

  try {
    const parsed = JSON.parse(rawText);
    body = parsed;
    if (parsed && typeof parsed === 'object' && 'code' in parsed) {
      const codeVal = (parsed as Record<string, unknown>).code;
      if (typeof codeVal === 'string') {
        code = codeVal;
      }
    }
  } catch {
    // body bukan JSON — keep as text
  }

  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  console.error(`[${prefix}] Failed: status=${res.status}, body=${bodyStr}`);
  return new ApiError(
    `${prefix} failed: ${res.status} - ${bodyStr}`,
    res.status,
    code,
    body,
  );
}

export interface AvailableOrderItem {
  orderId: string;
  totalCents: number;
  currency: string;
  itemsCount: number;
  city?: string;
  createdAt: string;
  version: number;
}

export interface FetchAvailableOrdersResult {
  items: AvailableOrderItem[];
  hasMore: boolean;
}

/**
 * Ambil daftar order yang tersedia di driver pool.
 * AbortController 8 detik — fail fast kalau network unreachable.
 */
export async function fetchAvailableOrders(take?: number): Promise<FetchAvailableOrdersResult> {
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
    const data = await res.json() as FetchAvailableOrdersResult;
    return data;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('[fetchAvailableOrders] Request aborted due to 8s timeout — returning empty');
      return { items: [], hasMore: false };
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

// ─── Orders ────────────────────────────────────────────────────────────────

/**
 * Buat order baru.
 * Online-only — gagal langsung throw, tidak ada offline queue.
 */
export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const res = await fetchWithAuth(`${API_BASE}/orders`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

  if (res.status === 401) {
    throw new UnauthorizedError();
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gagal membuat order: ${res.status} - ${body}`);
  }

  return res.json() as Promise<Order>;
}

/**
 * Fetch satu order by id.
 * Customer pakai ini untuk initial state di OrderTrackingScreen — backend
 * validate ownership (customer hanya bisa baca order miliknya sendiri,
 * kalau bukan → 403 ForbiddenException).
 *
 * Throw pada error — tracking screen harus tau kalau gagal fetch
 * (beda dengan fetchAvailableOrders yang return [] karena driver pool
 * tolerates stale data). Di sini, customer yang baru saja create order
 * WAJUM liat status aktualnya.
 */
export async function getOrderById(orderId: string): Promise<Order> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetchWithAuth(`${API_BASE}/orders/${orderId}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) throw new Error(`getOrderById failed: ${res.status}`);
    return res.json() as Promise<Order>;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('[getOrderById] Request aborted due to 8s timeout');
    }
    throw err;
  }
}

// ─── Driver Actions ──────────────────────────────────────────────────────────

/**
 * Response from driver action endpoints (reject, cancel, collect-cod).
 */
export interface DriverActionResponse {
  id: string;
  status: string;
  version: number;
  driverId?: string;
  [key: string]: unknown;
}

/**
 * Driver rejects an assigned order.
 * Order must be in status ASSIGNED.
 */
export async function rejectOrder(orderId: string, version: number): Promise<DriverActionResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetchWithAuth(`${API_BASE}/orders/${orderId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ version }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 401) {
      throw new UnauthorizedError();
    }

    if (!res.ok) {
      throw await buildApiError('rejectOrder', res);
    }

    return res.json() as Promise<DriverActionResponse>;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('[rejectOrder] Request aborted due to 8s timeout');
    }
    throw err;
  }
}

/**
 * Driver cancels order mid-delivery.
 * Order must be in status ASSIGNED, PREPARING, or OUT_FOR_DELIVERY.
 */
export async function cancelOrder(
  orderId: string,
  version: number,
  reason?: string
): Promise<DriverActionResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetchWithAuth(`${API_BASE}/orders/${orderId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ version, reason }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 401) {
      throw new UnauthorizedError();
    }

    if (!res.ok) {
      throw await buildApiError('cancelOrder', res);
    }

    return res.json() as Promise<DriverActionResponse>;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('[cancelOrder] Request aborted due to 8s timeout');
    }
    throw err;
  }
}

/**
 * Driver accepts a pool order.
 * Order must be in status ASSIGNED with no driver assigned.
 */
export async function acceptOrder(orderId: string, version: number): Promise<DriverActionResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetchWithAuth(`${API_BASE}/orders/${orderId}/accept`, {
      method: 'POST',
      body: JSON.stringify({ version }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 401) {
      throw new UnauthorizedError();
    }

    if (!res.ok) {
      throw await buildApiError('acceptOrder', res);
    }

    return res.json() as Promise<DriverActionResponse>;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('[acceptOrder] Request aborted due to 8s timeout');
    }
    throw err;
  }
}

/**
 * Driver collects COD (cash on delivery) for an order.
 * Uses idempotency key to prevent double-collection.
 */
export async function collectCodOrder(
  orderId: string,
  amountCents: number,
  idempotencyKey: string
): Promise<DriverActionResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetchWithAuth(`${API_BASE}/payments/${orderId}/collect-cod`, {
      method: 'POST',
      body: JSON.stringify({ amountCents, idempotencyKey }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 401) {
      throw new UnauthorizedError();
    }

    if (!res.ok) {
      throw await buildApiError('collectCodOrder', res);
    }

    return res.json() as Promise<DriverActionResponse>;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('[collectCodOrder] Request aborted due to 8s timeout');
    }
    throw err;
  }
}

/**
 * Flag COD as orphaned to server — driver collected COD offline but order
 * was reassigned before sync. Fire-and-forget: network failure here is
 * acceptable because the local `orphaned_needs_review` status is the fallback.
 */
export async function flagOrphanedCod(
  orderId: string,
  amountCents: number,
  idempotencyKey: string
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetchWithAuth(`${API_BASE}/payments/${orderId}/flag-orphaned`, {
      method: 'POST',
      body: JSON.stringify({ amountCents, idempotencyKey }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 401) {
      throw new UnauthorizedError();
    }

    if (!res.ok) {
      const body = await res.text();
      console.warn(`[flagOrphanedCod] Server rejected: status=${res.status}, body=${body}`);
      // Non-fatal — local orphan status is the fallback
    } else {
      console.log(`[flagOrphanedCod] Orphan flagged for order ${orderId}`);
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('[flagOrphanedCod] Request aborted due to 8s timeout — non-fatal');
    } else {
      console.warn('[flagOrphanedCod] Network error — non-fatal, local orphan status preserved:', err.message);
    }
    // Fire-and-forget: throw is intentionally suppressed
  }
}

/**
 * Driver updates order status.
 * Transitions: PREPARING → OUT_FOR_DELIVERY, OUT_FOR_DELIVERY → DELIVERED.
 */
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  version: number,
): Promise<Order> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetchWithAuth(`${API_BASE}/orders/${orderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, version }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 401) {
      throw new UnauthorizedError();
    }

    if (!res.ok) {
      throw await buildApiError('updateOrderStatus', res);
    }

    return res.json() as Promise<Order>;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[updateOrderStatus] Request aborted due to 8s timeout');
    }
    throw err;
  }
}
