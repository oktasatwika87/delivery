import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prismaProvider = {
  provide: PrismaClient,
  useFactory: () => new PrismaClient(),
};

@Global()
@Module({
  providers: [prismaProvider],
  exports: [PrismaClient],
})
export class PrismaModule {}
