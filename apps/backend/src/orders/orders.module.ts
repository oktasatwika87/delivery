import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';
import { ReassignmentService } from './reassignment.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, ScheduleModule.forRoot()],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersGateway, ReassignmentService],
  exports: [OrdersService, OrdersGateway],
})
export class OrdersModule {}
