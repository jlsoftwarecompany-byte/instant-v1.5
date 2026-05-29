-- Two-phase opener/normal message economy (Prompt 1)
-- Messages are either an "opener" (long timer, no reward yet) or a "normal" message
-- (short timer). Responding to an opener awards both users fixed links and flips the
-- conversation to the "active" phase. If a normal message timer expires unanswered the
-- whole chat is wiped.
ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'normal';
ALTER TABLE messages ADD COLUMN is_responded_to INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN phase TEXT DEFAULT 'awaiting_response';
ALTER TABLE conversations ADD COLUMN opener_initiator TEXT;
ALTER TABLE conversations ADD COLUMN opener_timer_choice INTEGER;
