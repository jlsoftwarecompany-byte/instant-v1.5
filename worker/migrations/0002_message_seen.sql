-- Add seen status to messages for read receipts (✓ / ✓✓)
ALTER TABLE messages ADD COLUMN seen BOOLEAN DEFAULT 0;
