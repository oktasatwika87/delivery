import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import { ServeStaticModule } from '@nestjs/serve-static';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { ChatModule } from './chat/chat.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Serve static files (future CDN assets, app manifests, etc.)
    // Accessible at /static/. The offline map style is now self-hosted
    // via tileserver-gl — see TILE_BASE_URL in mobile/.env.development.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/static',
    }),
    PrismaModule,
    AuthModule,
    OrdersModule,
    PaymentsModule,
    ChatModule,
    SyncModule,
  ],
})
export class AppModule {}
