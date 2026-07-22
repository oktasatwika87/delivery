import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import type { CreateOrderInput } from '@delivery/shared';

import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ordersService.findById(id);
  }

  @Post()
  create(@Body() input: CreateOrderInput) {
    return this.ordersService.create(input);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { status: string; version: number },
  ) {
    return this.ordersService.transitionStatus(id, body.status, body.version);
  }
}
