/**
 * Unit tests untuk AuthService.
 *
 * 3 skenario:
 * 1. register() sukses -> user dibuat, token dikembalikan
 * 2. register() gagal phone duplikat -> ConflictException
 * 3. login() gagal password salah -> UnauthorizedException
 */

import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Mock UserRole constant
const UserRole = {
  CUSTOMER: 'CUSTOMER',
  DRIVER: 'DRIVER',
} as const;

jest.mock('@delivery/shared', () => ({
  UserRole,
}));

// Mock Prisma methods
const mockPrismaUserFindUnique = jest.fn();
const mockPrismaUserCreate = jest.fn();

import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaClient,
          useValue: {
            user: {
              findUnique: mockPrismaUserFindUnique,
              create: mockPrismaUserCreate,
            },
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-jwt-token'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('register()', () => {
    const registerDto = {
      phone: '+6281234567890',
      password: 'securepassword123',
      name: 'John Doe',
      role: UserRole.CUSTOMER,
    };

    test('sukses -> user dibuat, token dikembalikan', async () => {
      mockPrismaUserFindUnique.mockResolvedValue(null); // phone belum ada
      mockPrismaUserCreate.mockResolvedValue({
        id: 'user-uuid-123',
        role: UserRole.CUSTOMER,
        name: 'John Doe',
        phone: '+6281234567890',
        passwordHash: await bcrypt.hash('securepassword123', 10),
      });

      const result = await service.register(registerDto);

      expect(result).toHaveProperty('token', 'mock-jwt-token');
      expect(result).toHaveProperty('user');
      expect(result.user.id).toBe('user-uuid-123');
      expect(result.user.role).toBe(UserRole.CUSTOMER);
      expect(result.user.name).toBe('John Doe');
      expect(result.user.phone).toBe('+6281234567890');
      expect(result.user.version).toBe(1);
      expect(mockPrismaUserFindUnique).toHaveBeenCalledWith({
        where: { phone: '+6281234567890' },
      });
      expect(mockPrismaUserCreate).toHaveBeenCalled();
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-uuid-123',
        role: UserRole.CUSTOMER,
      });
    });

    test('gagal -> phone sudah terdaftar, ConflictException', async () => {
      // User dengan phone ini sudah ada
      mockPrismaUserFindUnique.mockResolvedValue({
        id: 'existing-user-id',
        phone: '+6281234567890',
        role: UserRole.CUSTOMER,
        name: 'Existing User',
        passwordHash: 'somehash',
      });

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
      await expect(service.register(registerDto)).rejects.toThrow(
        'Nomor +6281234567890 sudah terdaftar',
      );
      // Create tidak boleh dipanggil karena phone sudah ada
      expect(mockPrismaUserCreate).not.toHaveBeenCalled();
    });
  });

  describe('login()', () => {
    const loginDto = {
      phone: '+6281234567890',
      password: 'correctpassword',
    };

    test('gagal -> password salah, UnauthorizedException', async () => {
      const storedHash = await bcrypt.hash('correctpassword', 10);
      mockPrismaUserFindUnique.mockResolvedValue({
        id: 'user-uuid-456',
        role: UserRole.CUSTOMER,
        name: 'Jane Doe',
        phone: '+6281234567890',
        passwordHash: storedHash,
      });

      // Login dengan password yang salah
      await expect(
        service.login({ phone: '+6281234567890', password: 'wrongpassword' }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.login({ phone: '+6281234567890', password: 'wrongpassword' }),
      ).rejects.toThrow('Nomor HP atau kata sandi salah');
    });

    test('gagal -> user tidak ditemukan, UnauthorizedException', async () => {
      mockPrismaUserFindUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Nomor HP atau kata sandi salah');
    });
  });
});
