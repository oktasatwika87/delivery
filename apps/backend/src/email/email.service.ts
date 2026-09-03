import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

interface OrphanedCodEmailData {
  orderId: string;
  amountCents: number;
  currency: string;
  driverId: string;
  driverName: string;
  happenedAt: Date;
}

/**
 * Email service untuk notifikasi operational.
 * Konfigurasi via env variables:
 * - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 * - ORPHAN_NOTIFY_EMAIL (tujuan untuk orphan COD notifications)
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly notifyEmail: string;

  constructor(private readonly configService: ConfigService) {
    this.notifyEmail = this.configService.get<string>('ORPHAN_NOTIFY_EMAIL', '');

    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<number>('SMTP_PORT');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    if (host && port && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log('Email service configured');
    } else {
      this.logger.warn(
        'Email service not configured — SMTP env vars missing. ' +
        'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS to enable email notifications.',
      );
    }
  }

  /**
   * Kirim notifikasi orphan COD ke HSIN.
   * Fire-and-forget — gagal kirim email tidak boleh block endpoint.
   */
  async sendOrphanedCodNotification(data: OrphanedCodEmailData): Promise<void> {
    if (!this.notifyEmail) {
      this.logger.warn('[email] ORPHAN_NOTIFY_EMAIL not configured — skipping notification');
      return;
    }

    if (!this.transporter) {
      this.logger.warn('[email] SMTP not configured — skipping notification');
      return;
    }

    const amountFormatted = new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: data.currency,
    }).format(data.amountCents / 100);

    const subject = `[Delivery] Orphaned COD — Order ${data.orderId.slice(0, 8)}`;
    const text = `
Orphaned COD Detected

Order ID: ${data.orderId}
Amount: ${amountFormatted}
Driver: ${data.driverName} (${data.driverId})
Waktu kejadian: ${data.happenedAt.toISOString()}

Driver sudah collect COD secara offline, tapi order sudah direassign/cancelled
sebelum sync ke server. Perlu manual review dan resolusi.

---
Delivery System — otomatis dari backend
`.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #dc2626; color: white; padding: 16px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
    .detail { background: white; padding: 12px; border-radius: 6px; margin: 12px 0; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .detail-row:last-child { border-bottom: none; }
    .label { color: #6b7280; font-size: 14px; }
    .value { font-weight: 500; }
    .footer { margin-top: 16px; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin:0;">Orphaned COD Detected</h2>
    </div>
    <div class="content">
      <p>Driver sudah collect COD secara offline, tapi order sudah direassign/cancelled sebelum sync ke server. Perlu manual review dan resolusi.</p>
      <div class="detail">
        <div class="detail-row"><span class="label">Order ID</span><span class="value">${data.orderId}</span></div>
        <div class="detail-row"><span class="label">Jumlah COD</span><span class="value">${amountFormatted}</span></div>
        <div class="detail-row"><span class="label">Driver</span><span class="value">${data.driverName} (${data.driverId.slice(0, 8)}...)</span></div>
        <div class="detail-row"><span class="label">Waktu Kejadian</span><span class="value">${data.happenedAt.toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })}</span></div>
      </div>
      <p class="footer">Delivery System — email otomatis dari backend</p>
    </div>
  </div>
</body>
</html>
`;

    try {
      await this.transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM', 'noreply@delivery.app'),
        to: this.notifyEmail,
        subject,
        text,
        html,
      });
      this.logger.log(`[email] Orphaned COD notification sent for order ${data.orderId}`);
    } catch (err) {
      // Fire-and-forget — log error tapi jangan throw
      this.logger.error(`[email] Failed to send orphan notification for order ${data.orderId}:`, err);
    }
  }
}
