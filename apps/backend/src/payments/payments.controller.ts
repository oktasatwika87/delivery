import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import type { CreatePaymentInput } from '@delivery/shared';

import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Post()
  create(@Body() input: CreatePaymentInput) {
    return this.service.create(input);
  }

  @Post(':orderId/capture')
  capture(@Param('orderId', new ParseUUIDPipe()) orderId: string) {
    return this.service.capture(orderId);
  }
}
