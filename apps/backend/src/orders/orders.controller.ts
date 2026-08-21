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
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';

import type { CreateOrderInput } from '@delivery/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrdersService } from './orders.service';
import { UserRole } from '@delivery/shared';

interface CancelOrderDto {
  version: number;
  reason?: string;
}

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * List orders yang siap di-accept oleh driver.
   * HANYA bisa diakses oleh user dengan role DRIVER.
   */
  @Get('available')
  @HttpCode(HttpStatus.OK)
  async findAvailable(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Query('take') takeStr?: string,
  ) {
    if (role !== UserRole.DRIVER) {
      throw new ForbiddenException('Only drivers can view available pool');
    }
    const take = Math.min(Math.max(parseInt(takeStr ?? '50', 10) || 50, 1), 100);
    return this.ordersService.findAvailable(userId, take);
  }

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
   * Driver cancel order mid-delivery.
   * HANYA bisa diakses oleh user dengan role DRIVER.
   * Order harus dalam status ASSIGNED, PREPARING, atau OUT_FOR_DELIVERY.
   * Setelah cancel, order kembali ke CONFIRMED dan bisa di-assign ke driver lain.
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CancelOrderDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    if (role !== UserRole.DRIVER) {
      throw new ForbiddenException('Only drivers can cancel orders');
    }
    return this.ordersService.cancelOrder(id, body.version, userId, body.reason);
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
