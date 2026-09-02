/**
 * Unit tests untuk OrdersGateway
 *
 * Coverage:
 * 1. handleConnection - valid JWT + DRIVER role → join drivers:available room
 * 2. handleConnection - valid JWT + CUSTOMER role → TIDAK join drivers:available
 * 3. handleConnection - missing token → disconnect
 * 4. handleConnection - invalid token → disconnect
 * 5. handleDisconnect - cleanup userSockets map
 * 6. handleDisconnect - last socket deleted → remove map entry
 * 7. emitOrderAvailable - broadcasts to room with minimal payload
 * 8. emitOrderUnavailable - broadcasts with correct reason enum
 * 9. emitOrderCodCollected - broadcasts to customer, no status/version field
 */

import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';

import { OrdersGateway } from './orders.gateway';
import { UserRole } from '@delivery/shared';

describe('OrdersGateway', () => {
  let gateway: OrdersGateway;
  let mockJwtService: { verify: jest.Mock };
  let mockServer: { to: jest.Mock; emit: jest.Mock };

  const driverPayload = { sub: 'driver-uuid', role: UserRole.DRIVER };
  const customerPayload = { sub: 'customer-uuid', role: UserRole.CUSTOMER };

  function makeMockSocket(overrides: Partial<Socket> = {}): Socket {
    return {
      id: 'socket-123',
      handshake: { auth: {} } as any,
      data: {} as any,
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      ...overrides,
    } as unknown as Socket;
  }

  beforeEach(() => {
    mockJwtService = { verify: jest.fn() };
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    gateway = new OrdersGateway(mockJwtService as unknown as JwtService);
    // Inject mock server via property assignment
    (gateway as any).server = mockServer;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===== handleConnection tests =====

  describe('handleConnection', () => {
    test('valid JWT + DRIVER role → join drivers:available room', async () => {
      const socket = makeMockSocket({
        handshake: { auth: { token: 'valid-token' } } as any,
      });
      mockJwtService.verify.mockReturnValue(driverPayload);

      await gateway.handleConnection(socket);

      expect(mockJwtService.verify).toHaveBeenCalledWith('valid-token');
      expect(socket.join).toHaveBeenCalledWith('drivers:available');
      expect(socket.data['userId']).toBe('driver-uuid');
      expect(socket.data['role']).toBe(UserRole.DRIVER);
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    test('valid JWT + CUSTOMER role → join own userId room, TIDAK join drivers:available', async () => {
      const socket = makeMockSocket({
        handshake: { auth: { token: 'valid-token' } } as any,
      });
      mockJwtService.verify.mockReturnValue(customerPayload);

      await gateway.handleConnection(socket);

      expect(mockJwtService.verify).toHaveBeenCalledWith('valid-token');
      expect(socket.join).toHaveBeenCalledWith('customer-uuid');
      expect(socket.join).not.toHaveBeenCalledWith('drivers:available');
      expect(socket.data['userId']).toBe('customer-uuid');
      expect(socket.data['role']).toBe(UserRole.CUSTOMER);
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    test('missing token → disconnect', async () => {
      const socket = makeMockSocket({
        handshake: { auth: {} } as any,
      });

      await gateway.handleConnection(socket);

      expect(mockJwtService.verify).not.toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalled();
    });

    test('invalid token → disconnect', async () => {
      const socket = makeMockSocket({
        handshake: { auth: { token: 'invalid-token' } } as any,
      });
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await gateway.handleConnection(socket);

      expect(mockJwtService.verify).toHaveBeenCalledWith('invalid-token');
      expect(socket.disconnect).toHaveBeenCalled();
    });

    test('valid token but missing sub → disconnect', async () => {
      const socket = makeMockSocket({
        handshake: { auth: { token: 'valid-token' } } as any,
      });
      mockJwtService.verify.mockReturnValue({ sub: '', role: UserRole.DRIVER });

      await gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalled();
    });
  });

  // ===== handleDisconnect tests =====

  describe('handleDisconnect', () => {
    test('cleanup userSockets map - removes socket from set', async () => {
      const socket = makeMockSocket();
      socket.data['userId'] = 'driver-uuid';

      // Pre-populate: driver has 2 sockets
      (gateway as any).userSockets.set('driver-uuid', new Set(['socket-999', 'socket-123']));

      gateway.handleDisconnect(socket);

      const sockets = (gateway as any).userSockets.get('driver-uuid');
      expect(sockets?.has('socket-123')).toBe(false);
      expect(sockets?.has('socket-999')).toBe(true);
    });

    test('last socket deleted → remove map entry', async () => {
      const socket = makeMockSocket();
      socket.data['userId'] = 'driver-uuid';

      // Pre-populate: driver has only this socket
      (gateway as any).userSockets.set('driver-uuid', new Set(['socket-123']));

      gateway.handleDisconnect(socket);

      expect((gateway as any).userSockets.has('driver-uuid')).toBe(false);
    });

    test('no userId on socket → no-op', () => {
      const socket = makeMockSocket();
      // socket.data['userId'] is undefined

      expect(() => gateway.handleDisconnect(socket)).not.toThrow();
      expect((gateway as any).userSockets.size).toBe(0);
    });
  });

  // ===== emitOrderAvailable tests =====

  describe('emitOrderAvailable', () => {
    test('broadcasts to room with minimal payload', () => {
      const mockOrder = {
        id: 'order-123',
        totalCents: 50000,
        currency: 'IDR',
        items: [{ id: 'item-1' }, { id: 'item-2' }],
        deliveryAddress: { city: 'Denpasar' },
        createdAt: '2026-08-20T10:00:00.000Z',
      } as any;

      gateway.emitOrderAvailable(mockOrder);

      expect(mockServer.to).toHaveBeenCalledWith('drivers:available');
      expect(mockServer.emit).toHaveBeenCalledWith('order:available', {
        orderId: 'order-123',
        totalCents: 50000,
        currency: 'IDR',
        itemsCount: 2,
        city: 'Denpasar',
        createdAt: '2026-08-20T10:00:00.000Z',
      });
    });

    test('minimal payload - omits full address/items', () => {
      const mockOrder = {
        id: 'order-456',
        totalCents: 75000,
        currency: 'IDR',
        items: [{ id: 'item-1' }],
        deliveryAddress: {
          street: 'Jl. Sudirman No. 123',
          city: 'Badung',
          postalCode: '80361',
        },
        createdAt: '2026-08-20T12:00:00.000Z',
      } as any;

      gateway.emitOrderAvailable(mockOrder);

      const payload = mockServer.emit.mock.calls[0][1];
      expect(payload.orderId).toBe('order-456');
      expect(payload.itemsCount).toBe(1);
      expect(payload.city).toBe('Badung');
      // Should NOT include: items[], deliveryAddress (full object), street, postalCode
      expect(payload).not.toHaveProperty('street');
      expect(payload).not.toHaveProperty('postalCode');
    });
  });

  // ===== emitOrderUnavailable tests =====

  describe('emitOrderUnavailable', () => {
    test('broadcasts with reason = accepted', () => {
      gateway.emitOrderUnavailable('order-123', 'accepted');

      expect(mockServer.to).toHaveBeenCalledWith('drivers:available');
      expect(mockServer.emit).toHaveBeenCalledWith('order:unavailable', {
        orderId: 'order-123',
        reason: 'accepted',
      });
    });

    test('broadcasts with reason = rejected', () => {
      gateway.emitOrderUnavailable('order-456', 'rejected');

      expect(mockServer.emit).toHaveBeenCalledWith('order:unavailable', {
        orderId: 'order-456',
        reason: 'rejected',
      });
    });

    test('broadcasts with reason = reassigned', () => {
      gateway.emitOrderUnavailable('order-789', 'reassigned');

      expect(mockServer.emit).toHaveBeenCalledWith('order:unavailable', {
        orderId: 'order-789',
        reason: 'reassigned',
      });
    });
  });

  // ===== emitOrderAccepted/Rejected/Cancelled (existing) =====

  describe('emitOrderAccepted', () => {
    test('broadcasts to customerId room', () => {
      gateway.emitOrderAccepted('customer-uuid', 'order-123', 'driver-uuid', 2);

      expect(mockServer.to).toHaveBeenCalledWith('customer-uuid');
      expect(mockServer.emit).toHaveBeenCalledWith('order:accepted', {
        orderId: 'order-123',
        driverId: 'driver-uuid',
        status: 'PREPARING',
        version: 2,
      });
    });
  });

  describe('emitOrderRejected', () => {
    test('broadcasts to customerId room with CONFIRMED status (reassign-able, not terminal)', () => {
      // FIX (2026-09): status was 'CANCELLED' in old test — reject now goes
      // back to CONFIRMED (same as cancel) so order can be reassigned.
      // See orders.service.ts rejectOrder() + orders.gateway.ts emitOrderRejected.
      gateway.emitOrderRejected('customer-uuid', 'order-123', 2);

      expect(mockServer.to).toHaveBeenCalledWith('customer-uuid');
      expect(mockServer.emit).toHaveBeenCalledWith('order:rejected', {
        orderId: 'order-123',
        status: 'CONFIRMED',
        version: 2,
      });
    });
  });

  describe('emitOrderCancelled', () => {
    test('broadcasts to customerId room with reason', () => {
      gateway.emitOrderCancelled('customer-uuid', 'order-123', 3, 'Kendaraan mogok');

      expect(mockServer.to).toHaveBeenCalledWith('customer-uuid');
      expect(mockServer.emit).toHaveBeenCalledWith('order:cancelled', {
        orderId: 'order-123',
        status: 'CONFIRMED',
        version: 3,
        reason: 'Kendaraan mogok',
      });
    });
  });

  describe('emitOrderCodCollected', () => {
    test('broadcasts to customerId room, no status/version field', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-02T08:00:00.000Z'));

      gateway.emitOrderCodCollected('customer-uuid', 'order-123', 50000, 'IDR');

      expect(mockServer.to).toHaveBeenCalledWith('customer-uuid');
      expect(mockServer.emit).toHaveBeenCalledWith('order:cod_collected', {
        orderId: 'order-123',
        amountCents: 50000,
        currency: 'IDR',
        collectedAt: '2026-09-02T08:00:00.000Z',
      });

      jest.useRealTimers();
    });
  });
});
