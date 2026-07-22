import { ExecutionContext, createParamDecorator } from '@nestjs/common';

/**
 * Helper ambil req.user.id / req.user.role dari controller tanpa harus
 * pegang @Req() seluruh object. Pasang di belakang JwtAuthGuard.
 *
 * Contoh:
 *   @UseGuards(JwtAuthGuard)
 *   @Post()
 *   create(@CurrentUser('id') userId: string, @Body() dto: ...) { ... }
 */
export const CurrentUser = createParamDecorator(
  (field: string | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { id: string; role: string } | undefined;
    if (!user) {
      // Tanpa guard = bug programming, fail loud.
      throw new Error('CurrentUser used without authenticated request');
    }
    return field ? user[field as keyof typeof user] : user;
  },
);