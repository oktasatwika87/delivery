import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

/** Pola idempotency key untuk COD: `cod:` + UUID v4. */
const IDEMPOTENCY_KEY_PATTERN = /^cod:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Request body untuk POST /payments/:orderId/collect-cod. */
export class CollectCodDto {
  @IsString()
  @Matches(IDEMPOTENCY_KEY_PATTERN, {
    message: 'idempotencyKey wajib pola cod:<uuid>',
  })
  idempotencyKey!: string;

  /** Tidak dipakai, jumlah dari order.totalCents. */
  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;
}

/** Request body untuk POST /payments/:orderId/flag-orphaned. */
export class FlagOrphanedDto {
  @IsString()
  @Matches(IDEMPOTENCY_KEY_PATTERN, {
    message: 'idempotencyKey wajib pola cod:<uuid>',
  })
  idempotencyKey!: string;

  /** Tidak dipakai, jumlah dari server. */
  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;
}
