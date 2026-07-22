import { Model } from '@nozbe/watermelondb';
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators';

import type { UserRole } from '@delivery/shared';

export class UserModel extends Model {
  static override table = 'users';

  @text('name') name!: string;
  @text('phone') phone!: string;
  @text('role') role!: UserRole;
  @field('server_version') serverVersion!: number;

  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}
