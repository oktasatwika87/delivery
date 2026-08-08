-- Add cancel tracking fields to Order
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancelled_by" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancel_reason" TEXT;
