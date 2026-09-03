-- Migration: add_last_seen_at
-- Add last_seen_at column to users table for driver reassignment timeout feature

ALTER TABLE "users" ADD COLUMN "last_seen_at" TIMESTAMPTZ DEFAULT NOW();
