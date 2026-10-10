import { Body, Controller, ForbiddenException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PaymentsService } from './payments.service';
import { UserRole } from '@delivery/shared';
import { CollectCodDto, FlagOrphanedDto } from './payments.dto';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

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
      throw new ForbiddenException('Hanya driver yang bisa mencatat COD');
    }
    return this.service.collectCod(orderId, userId, body.idempotencyKey);
  }

  /**
   * Flag COD as orphaned, driver collected COD offline but order was reassigned
   * before sync. Server marks the payment as orphaned and notifies HSIN.
   * HANYA bisa diakses oleh user dengan role DRIVER.
   */
  @Post(':orderId/flag-orphaned')
  flagOrphaned(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() body: FlagOrphanedDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    if (role !== UserRole.DRIVER) {
      throw new ForbiddenException('Hanya driver yang bisa melaporkan COD yatim');
    }
    return this.service.flagOrphanedCod(orderId, userId, body.idempotencyKey);
  }
}
