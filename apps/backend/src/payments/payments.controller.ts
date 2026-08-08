import { Body, Controller, ForbiddenException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import type { CreatePaymentInput } from '@delivery/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PaymentsService } from './payments.service';
import { UserRole } from '@delivery/shared';

interface CollectCodDto {
  amountCents: number;
  idempotencyKey: string;
}

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Post()
  create(
    @Body() input: CreatePaymentInput,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.create(input, userId);
  }

  @Post(':orderId/capture')
  capture(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.capture(orderId, userId);
  }

  /**
   * Driver collects COD (cash on delivery) for an order.
   * HANYA bisa diakses oleh user dengan role DRIVER.
   */
  @Post(':orderId/collect-cod')
  collectCod(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() body: CollectCodDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    if (role !== UserRole.DRIVER) {
      throw new ForbiddenException('Only drivers can collect COD');
    }
    return this.service.collectCod(orderId, userId, body.amountCents, body.idempotencyKey);
  }
}
