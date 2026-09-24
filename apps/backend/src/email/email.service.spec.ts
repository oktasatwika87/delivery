/**
 * Unit tests untuk EmailService.sendOrphanedCodNotification()
 *
 * Coverage:
 * 1. berhasil kirim email dengan data yang benar (amountCents tanpa /100)
 * 2. skip kalau ORPHAN_NOTIFY_EMAIL kosong (logger.warn, transporter tidak dipanggil)
 * 3. skip kalau SMTP belum diisi (transporter null, logger.warn)
 * 4. fire-and-forget: transporter error tidak throw
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

import { EmailService } from './email.service';

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => mockCreateTransport(...args),
}));

async function createService(notifyEmail: string, smtpConfigured: boolean): Promise<EmailService> {
  const mockConfig = {
    get: jest.fn((key: string, defaultValue?: string | number) => {
      if (key === 'ORPHAN_NOTIFY_EMAIL') return notifyEmail;
      if (key === 'SMTP_HOST') return smtpConfigured ? 'smtp.test.com' : undefined;
      if (key === 'SMTP_PORT') return smtpConfigured ? 465 : undefined;
      if (key === 'SMTP_USER') return smtpConfigured ? 'user@test.com' : undefined;
      if (key === 'SMTP_PASS') return smtpConfigured ? 'password' : undefined;
      if (key === 'SMTP_FROM') return 'noreply@test.com';
      return defaultValue;
    }),
  };

  // Pakai TestingModule agar ConfigService dapat provider asli tanpa cast.
  // Test.createTestingModule bypass constructor jadi tidak membaca process.env.
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      EmailService,
      { provide: ConfigService, useValue: mockConfig },
    ],
  }).compile();
  return moduleRef.get<EmailService>(EmailService);
}

const TEST_DATA = {
  orderId: '12345678-0000-0000-0000-000000000000',
  amountCents: 23000,
  currency: 'IDR',
  driverId: 'driver-abc',
  driverName: 'Budi Santoso',
  happenedAt: new Date('2026-09-01T10:00:00.000Z'),
};

describe('EmailService.sendOrphanedCodNotification()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
  });

  it('berhasil kirim email dengan subject, text, dan html yang benar', async () => {
    // amountCents 23000 harus muncul Rp 23.000 (bukan Rp 230) di email.
    const service = await createService('ops@example.com', true);
    mockSendMail.mockResolvedValue(undefined);

    await service.sendOrphanedCodNotification(TEST_DATA);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const [mailArgs] = mockSendMail.mock.calls[0];
    expect(mailArgs.from).toBe('noreply@test.com');
    expect(mailArgs.to).toBe('ops@example.com');
    expect(mailArgs.subject).toContain('12345678'); // orderId prefix
    // amountCents 23000 diformat tanpa /100. Intl.NumberFormat default
    // minimumFractionDigits untuk currency = 2, jadi muncul "Rp 23.000,00"
    expect(mailArgs.text).toContain('23.000');
    expect(mailArgs.text).toContain('Budi Santoso');
    // HTML juga tanpa /100. Intl.NumberFormat default minimumFractionDigits: 2
    // untuk IDR menghasilkan "Rp 23.000,00"
    expect(mailArgs.html).toContain('23.000');
    expect(mailArgs.html).toContain('Budi Santoso');
  });

  it('skip kalau ORPHAN_NOTIFY_EMAIL kosong, transporter tidak dipanggil', async () => {
    const service = await createService('', true);
    // tidak mockSendMail, tidak boleh dipanggil

    await service.sendOrphanedCodNotification(TEST_DATA);

    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('skip kalau SMTP belum diisi, transporter null, transporter.sendMail tidak dipanggil', async () => {
    const service = await createService('ops@example.com', false);

    await service.sendOrphanedCodNotification(TEST_DATA);

    expect(mockCreateTransport).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('fire-and-forget: transporter error tidak throw', async () => {
    const service = await createService('ops@example.com', true);
    const error = new Error('SMTP connection failed');
    mockSendMail.mockRejectedValue(error);

    // Harus resolve tanpa throw meskipun sendMail gagal
    await expect(
      service.sendOrphanedCodNotification(TEST_DATA),
    ).resolves.toBeUndefined();

    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
});
