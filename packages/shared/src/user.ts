/**
 * Domain: User
 *
 * Role terpisah supaya mobile client bisa render nama driver/customer
 * di layar chat & order tanpa coupling ke auth layer.
 */

export const UserRole = {
  CUSTOMER: 'CUSTOMER',
  DRIVER: 'DRIVER',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export interface User {
  id: string;
  role: UserRole;
  name: string;
  phone: string;
  version: number;
}
