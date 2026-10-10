import { IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

import { UserRole } from '@delivery/shared';

/** Body untuk POST /auth/register. */
export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @MinLength(8, { message: 'Kata sandi minimal 8 karakter' })
  password!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  /** Optional, default CUSTOMER saat register dari mobile. */
  @IsOptional()
  @IsIn([UserRole.CUSTOMER, UserRole.DRIVER])
  role?: UserRole;
}

/** Body untuk POST /auth/login. */
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}