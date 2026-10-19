/**
 * Unit tests untuk OrdersGateway
 *
 * JWT diverifikasi di middleware namespace (lihat auth/socket-auth.ts)
 * yang dipasang lewat afterInit. handleConnection tinggal membaca
 * userId dan role dari socket.data, lalu join room yang sesuai.
 *
 * Coverage:
 * 1. afterInit - middleware dipasang sekali lewat server.use
 * 2. handleConnection - DRIVER sah: join room drivers:available
 * 3. handleConnection - CUSTOMER sah: join room id sendiri, bukan drivers:available
 * 4. handleConnection - tanpa userId: socket diputus
 * 5. handleConnection - role tidak dikenal: socket diputus
 * 6. handleDisconnect - cleanup userSockets map
 * 7. handleDisconnect - last socket deleted -> remove map entry
 * 8. emitOrderAvailable - broadcasts to room with minimal payload
 * 9. emitOrderUnavailable - broadcasts with correct reason enum
 * 10. emitOrderCodCollected - broadcasts to customer, no status/version field
 */

import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';

import { OrdersGateway } from './orders.gateway';
import { UserRole } from '@delivery/shared';

describe('OrdersGateway', () => {
  let gateway: OrdersGateway;
  let mockJwtService: { verify: jest.Mock };
  let mockServer: { to: jest.Mock; emit: jest.Mock; use: jest.Mock };

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
      use: jest.fn(),
    };

    gateway = new OrdersGateway(mockJwtService as unknown as JwtService);
    // Inject mock server via property assignment
    (gateway as any).server = mockServer;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===== afterInit =====

  describe('afterInit', () => {
    test('memasang middleware lewat server.use tepat sekali', () => {
      const namespace = { use: jest.fn() };

      gateway.afterInit(namespace);

      expect(namespace.use).toHaveBeenCalledTimes(1);
      expect(typeof namespace.use.mock.calls[0][0]).toBe('function');
    });
  });

  // ===== handleConnection tests =====

  describe('handleConnection', () => {
    test('data berisi userId dan role DRIVER: join drivers:available, verify tidak dipanggil', async () => {
      const socket = makeMockSocket();
      socket.data['userId'] = driverPayload.sub;
      socket.data['role'] = driverPayload.role;

      await gateway.handleConnection(socket);

      expect(mockJwtService.verify).not.toHaveBeenCalled();
      expect(socket.join).toHaveBeenCalledWith('drivers:available');
      expect(socket.join).not.toHaveBeenCalledWith(driverPayload.sub);
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    test('data berisi userId dan role CUSTOMER: join room id sendiri, bukan drivers:available', async () => {
      const socket = makeMockSocket();
      socket.data['userId'] = customerPayload.sub;
      socket.data['role'] = customerPayload.role;

      await gateway.handleConnection(socket);

      expect(mockJwtService.verify).not.toHaveBeenCalled();
      expect(socket.join).toHaveBeenCalledWith(customerPayload.sub);
      expect(socket.join).not.toHaveBeenCalledWith('drivers:available');
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    test('tanpa data.userId: socket diputus, tidak join apa pun', async () => {
      const socket = makeMockSocket();
      socket.data['role'] = UserRole.DRIVER;

      await gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
    });

    test('data.userId kosong: socket diputus, tidak join apa pun', async () => {
      const socket = makeMockSocket();
      socket.data['userId'] = '';
      socket.data['role'] = UserRole.DRIVER;

      await gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
    });

    test("role 'ADMIN' tidak dikenal: socket diputus, tidak join apa pun", async () => {
      const socket = makeMockSocket();
      socket.data['userId'] = 'attacker';
      socket.data['role'] = 'ADMIN';

      await gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
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

    test('last socket deleted -> remove map entry', async () => {
      const socket = makeMockSocket();
      socket.data['userId'] = 'driver-uuid';

      // Pre-populate: driver has only this socket
      (gateway as any).userSockets.set('driver-uuid', new Set(['socket-123']));

      gateway.handleDisconnect(socket);

      expect((gateway as any).userSockets.has('driver-uuid')).toBe(false);
    });

    test('no userId on socket jadi no-op', () => {
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
    test('broadcasts to customerId room with ASSIGNED status (back to pool)', () => {
      // Status 'ASSIGNED' dipakai karena single pool state, lihat
      // order-events.ts OrderRejectedPayload. 'CONFIRMED' dulu dipakai
      // sebagai transitional state; sekarang tidak ada gunanya lagi karena
      // releaseToPool kembali ke ASSIGNED + driverId null.
      gateway.emitOrderRejected('customer-uuid', 'order-123', 2);

      expect(mockServer.to).toHaveBeenCalledWith('customer-uuid');
      expect(mockServer.emit).toHaveBeenCalledWith('order:rejected', {
        orderId: 'order-123',
        status: 'ASSIGNED',
        version: 2,
      });
    });
  });

  describe('emitOrderCancelled', () => {
    test('broadcasts to customerId room with reason', () => {
      // Status 'ASSIGNED' karena order balik ke pool.
      gateway.emitOrderCancelled('customer-uuid', 'order-123', 3, 'Kendaraan mogok');

      expect(mockServer.to).toHaveBeenCalledWith('customer-uuid');
      expect(mockServer.emit).toHaveBeenCalledWith('order:cancelled', {
        orderId: 'order-123',
        status: 'ASSIGNED',
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

  describe('emitOrderStatusUpdated', () => {
    // Event baru untuk PATCH /orders/:id/status. Dipakai setelah transisi
    // PREPARING jadi OUT_FOR_DELIVERY atau OUT_FOR_DELIVERY jadi DELIVERED sukses,
    // dikirim ke customer room supaya OrderTrackingScreen tahu tanpa pull REST.
    test('broadcasts to customerId room with order:status_updated payload', () => {
      gateway.emitOrderStatusUpdated('customer-uuid', {
        orderId: 'order-123',
        status: 'OUT_FOR_DELIVERY',
        version: 4,
        updatedAt: '2026-09-24T08:00:00.000Z',
      });

      expect(mockServer.to).toHaveBeenCalledWith('customer-uuid');
      expect(mockServer.emit).toHaveBeenCalledWith('order:status_updated', {
        orderId: 'order-123',
        status: 'OUT_FOR_DELIVERY',
        version: 4,
        updatedAt: '2026-09-24T08:00:00.000Z',
      });
    });

    test('status field is the raw literal that comes in (not hardcoded)', () => {
      gateway.emitOrderStatusUpdated('customer-uuid', {
        orderId: 'order-456',
        status: 'DELIVERED',
        version: 7,
        updatedAt: '2026-09-24T08:30:00.000Z',
      });

      const payload = mockServer.emit.mock.calls[0][1];
      expect(payload.status).toBe('DELIVERED');
    });
  });
});
