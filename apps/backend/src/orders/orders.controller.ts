import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';

import type { CreateOrderInput } from '@delivery/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrdersService } from './orders.service';
import { UserRole } from '@delivery/shared';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.ordersService.findById(id, userId);
  }

  @Post()
  create(
    @Body() input: CreateOrderInput,
    @CurrentUser('id') userId: string,
  ) {
    return this.ordersService.create(input, userId);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { status: string; version: number },
    @CurrentUser('id') userId: string,
  ) {
    return this.ordersService.transitionStatus(id, body.status, body.version, userId);
  }

  /**
   * Driver accept order.
   * HANYA bisa diakses oleh user dengan role DRIVER.
   * Order harus dalam status ASSIGNED.
   */
  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  acceptOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { version: number },
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    if (role !== UserRole.DRIVER) {
      throw new ForbiddenException('Only drivers can accept orders');
    }
    return this.ordersService.acceptOrder(id, body.version, userId);
  }

  /**
   * Driver reject order.
   * HANYA bisa diakses oleh user dengan role DRIVER.
   * Order harus dalam status ASSIGNED.
   */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  rejectOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { version: number },
    @CurrentUser('role') role: string,
  ) {
    if (role !== UserRole.DRIVER) {
      throw new ForbiddenException('Only drivers can reject orders');
    }
    return this.ordersService.rejectOrder(id, body.version);
  }
}
