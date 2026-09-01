/**
 * Order-related Socket.IO event payload types — shared between apps/backend
 * (OrdersGateway emit calls, apps/backend/src/orders/orders.gateway.ts) and
 * apps/mobile (OrdersSocketManager listeners, apps/mobile/src/sync/ordersSocket.ts).
 *
 * Why this file exists: before this, these 5 payload shapes were hand-
 * duplicated in both files with no shared source of truth. That's exactly
 * what let the reject status literal drift out of sync — backend emitted
 * 'CANCELLED', mobile independently declared the same 'CANCELLED' literal,
 * and when the backend was fixed to 'CONFIRMED' (rejectOrder() previously
 * had no ownership check AND transitioned to a terminal status — see
 * OrdersService.rejectOrder()'s doc comment for the full history), the
 * mobile side had to be manually caught and fixed in 3 separate follow-up
 * commits (cdc5363, e7118ad, f5bbabe) because nothing forced the two
 * declarations to stay in sync. Importing both sides from here instead
 * means a status-literal change on one side is a compile-time type error
 * on the other, not a silent runtime drift that only shows up as a UI bug.
 *
 * Namespace: /orders (see OrdersGateway's @WebSocketGateway decorator).
 */

/** order:available — driver-targeted (broadcast to the drivers:available room). */
export interface OrderAvailablePayload {
  orderId: string;
  totalCents: number;
  currency: string;
  itemsCount: number;
  city?: string;
  createdAt: string;
}

/** order:unavailable — driver-targeted. */
export interface OrderUnavailablePayload {
  orderId: string;
  reason: 'accepted' | 'rejected' | 'reassigned';
}

/**
 * order:accepted — customer-targeted. Status hardcoded 'PREPARING' by the
 * server (see OrdersGateway.emitOrderAccepted).
 */
export interface OrderAcceptedPayload {
  orderId: string;
  driverId: string;
  status: 'PREPARING';
  version: number;
}

/**
 * order:rejected — customer-targeted. Status hardcoded 'CONFIRMED' by the
 * server: the order reverts to CONFIRMED (reassign-able), NOT terminal
 * CANCELLED — see OrdersGateway.emitOrderRejected and
 * OrdersService.rejectOrder() for why.
 */
export interface OrderRejectedPayload {
  orderId: string;
  status: 'CONFIRMED';
  version: number;
}

/**
 * order:cancelled — customer-targeted. Status hardcoded 'CONFIRMED' by the
 * server (see OrdersGateway.emitOrderCancelled).
 */
export interface OrderCancelledPayload {
  orderId: string;
  status: 'CONFIRMED';
  version: number;
  reason?: string;
}
