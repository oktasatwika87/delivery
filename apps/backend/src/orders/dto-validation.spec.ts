/**
 * Unit tests untuk DTO class validation.
 *
 * Tes semua DTO class dengan ValidationPipe untuk memastikan 400
 * dikembalikan untuk body yang salah tipe.
 */

import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import {
  OrderAcceptRejectDto,
  CancelOrderDto,
  OrderItemDto,
} from './orders.dto';
import { SendChatMessageDto } from '../chat/chat.dto';
import { CollectCodDto, FlagOrphanedDto } from '../payments/payments.dto';

describe('DTO class validation', () => {
  // OrderAcceptRejectDto

  describe('OrderAcceptRejectDto', () => {
    test('version integer positif, valid', async () => {
      const dto = plainToInstance(OrderAcceptRejectDto, { version: 1 });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    test('version string, invalid', async () => {
      const dto = plainToInstance(OrderAcceptRejectDto, { version: '1' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('version');
    });

    test('version 0, invalid', async () => {
      const dto = plainToInstance(OrderAcceptRejectDto, { version: 0 });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('version');
    });
  });

  // CancelOrderDto

  describe('CancelOrderDto', () => {
    test('version integer positif, reason opsional, valid', async () => {
      const dto = plainToInstance(CancelOrderDto, { version: 1, reason: 'alamat salah' });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    test('version integer positif, reason kosong, valid', async () => {
      const dto = plainToInstance(CancelOrderDto, { version: 1, reason: '' });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    test('version string, invalid', async () => {
      const dto = plainToInstance(CancelOrderDto, { version: '1' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('version');
    });

    test('reason lebih dari 500 karakter, invalid', async () => {
      const dto = plainToInstance(CancelOrderDto, { version: 1, reason: 'a'.repeat(501) });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('reason');
    });
  });

  // CollectCodDto

  describe('CollectCodDto', () => {
    test('idempotencyKey sesuai pola cod:<uuid>, amountCents opsional, valid', async () => {
      const dto = plainToInstance(CollectCodDto, {
        idempotencyKey: 'cod:a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        amountCents: 50000,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    test('amountCents opsional tidak dikirim, valid', async () => {
      const dto = plainToInstance(CollectCodDto, {
        idempotencyKey: 'cod:a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    test('idempotencyKey bukan string, invalid', async () => {
      const dto = plainToInstance(CollectCodDto, {
        idempotencyKey: 123,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    test('idempotencyKey tidak sesuai pola cod:<uuid>, invalid', async () => {
      const dto = plainToInstance(CollectCodDto, {
        idempotencyKey: 'not-a-cod-key',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('idempotencyKey');
    });
  });

  // FlagOrphanedDto

  describe('FlagOrphanedDto', () => {
    test('idempotencyKey sesuai pola cod:<uuid>, valid', async () => {
      const dto = plainToInstance(FlagOrphanedDto, {
        idempotencyKey: 'cod:a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        amountCents: 50000,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    test('idempotencyKey bukan string, invalid', async () => {
      const dto = plainToInstance(FlagOrphanedDto, {
        idempotencyKey: 999,
        amountCents: 50000,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  // SendChatMessageDto

  describe('SendChatMessageDto', () => {
    test('roomId UUID valid, body tidak kosong, valid', async () => {
      const dto = plainToInstance(SendChatMessageDto, {
        roomId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        body: 'hello',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    test('roomId bukan UUID, invalid', async () => {
      const dto = plainToInstance(SendChatMessageDto, {
        roomId: 'not-a-uuid',
        body: 'hello',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('roomId');
    });

    test('body kosong, invalid', async () => {
      const dto = plainToInstance(SendChatMessageDto, {
        roomId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        body: '',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('body');
    });

    test('id opsional UUID, valid', async () => {
      const dto = plainToInstance(SendChatMessageDto, {
        id: 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e',
        roomId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        body: 'hello',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    test('attachment opsional, valid', async () => {
      const dto = plainToInstance(SendChatMessageDto, {
        roomId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        body: 'hello',
        attachment: { kind: 'image', url: 'https://example.com/img.png' },
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    test('clientCreatedAt opsional string, valid', async () => {
      const dto = plainToInstance(SendChatMessageDto, {
        roomId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        body: 'hello',
        clientCreatedAt: '2024-01-01T00:00:00.000Z',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  // OrderItemDto (quantity)

  describe('OrderItemDto', () => {
    test('quantity integer minimal 1, valid', async () => {
      const dto = plainToInstance(OrderItemDto, {
        productId: 'prod-1',
        name: 'Item 1',
        quantity: 1,
        unitPriceCents: 1000,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    test('quantity 0, invalid', async () => {
      const dto = plainToInstance(OrderItemDto, {
        productId: 'prod-1',
        name: 'Item 1',
        quantity: 0,
        unitPriceCents: 1000,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('quantity');
    });

    test('quantity bukan integer, invalid', async () => {
      const dto = plainToInstance(OrderItemDto, {
        productId: 'prod-1',
        name: 'Item 1',
        quantity: 1.5,
        unitPriceCents: 1000,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('quantity');
    });
  });
});