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
 * order:rejected — customer-targeted. Status hardcoded 'ASSIGNED' by the
 * server: the order reverts to the pool state (ASSIGNED + driverId null),
 * NOT terminal CANCELLED — see OrdersGateway.emitOrderRejected and
 * OrdersService.rejectOrder() for why. Customer sees "Mencari driver"
 * lagi setelah reject, sama seperti order baru.
 */
export interface OrderRejectedPayload {
  orderId: string;
  status: 'ASSIGNED';
  version: number;
}

/**
 * order:cancelled — customer-targeted. Status hardcoded 'ASSIGNED' by the
 * server (lihat OrdersGateway.emitOrderCancelled dan OrdersService.cancelOrder).
 * Order balik ke pool — status ASSIGNED + driverId null, bukan terminal.
 */
export interface OrderCancelledPayload {
  orderId: string;
  status: 'ASSIGNED';
  version: number;
  reason?: string;
}

/**
 * order:cod_collected — customer-targeted. Fired when a driver collects
 * cash-on-delivery for an order (see PaymentsService.collectCod() and
 * OrdersGateway.emitOrderCodCollected).
 *
 * Deliberately has NO `status`/`version` field: collecting COD does not
 * change the order's status (it stays wherever it was, e.g. DELIVERING) —
 * this event is a live payment confirmation only, not a state-sync event.
 * Emitted once, from the successful-create branch of collectCod() only —
 * NOT on idempotency-key replay — so an outbox retry after a flaky network
 * response never double-notifies the customer for the same collection.
 */
export interface OrderCodCollectedPayload {
  orderId: string;
  amountCents: number;
  currency: string;
  collectedAt: string;
}

/**
 * order:status_updated — customer-targeted. Dipakai oleh PATCH /orders/:id/status
 * untuk dua transisi yang sempit: PREPARING → OUT_FOR_DELIVERY
 * dan OUT_FOR_DELIVERY → DELIVERED, dilakukan driver pemilik order. Customer
 * room menerima event ini supaya OrderTrackingScreen tahu tanpa pull REST.
 *
 * Payload identik shape dengan OrderAcceptedPayload kecuali tanpa driverId
 * (transisi ini tidak mengubah driver — driver yang sama dengan order.driverId).
 */
export interface OrderStatusUpdatedPayload {
  orderId: string;
  status: 'OUT_FOR_DELIVERY' | 'DELIVERED';
  version: number;
  updatedAt: string;
}
