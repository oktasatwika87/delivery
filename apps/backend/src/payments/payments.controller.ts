import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import type { CreatePaymentInput } from '@delivery/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PaymentsService } from './payments.service';

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
}
