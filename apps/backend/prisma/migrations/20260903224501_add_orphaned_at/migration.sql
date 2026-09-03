-- Migration: add_orphaned_at
-- Add orphaned_at column to payments table for orphaned COD detection feature

ALTER TABLE "payments" ADD COLUMN "orphaned_at" TIMESTAMPTZ;
