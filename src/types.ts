export interface User {
  id: number;
  username: string;
  nickname: string;
  created_at: string;
  links: number;
  push_subscription?: string | null;
  linker_avatar?: string;
  linker_color?: string;
  session_token?: string | null;
  session_expires_at?: string | null;
}

export interface Friendship {
  id: number;
  requester_username: string;
  receiver_username: string;
  status: 'pending' | 'accepted';
  created_at: string;
}

export interface Conversation {
  id: number;
  participant_1: string;
  participant_2: string;
  started_at: string;
  conversation_started: number; // 0 or 1
  saved: number; // 0 or 1
  // v1.5 — Adaptive Privacy (Strategic Plan §4)
  privacy_mode?: 'standard' | 'ephemeral' | 'anonymous' | 'incognito';
  disappear_after_seconds?: number | null;
  anonymous_mode?: number; // 0 or 1
}

export interface Timer {
  id: number;
  conversation_id: number;
  timer_type: 'opener' | 'response' | 'cooldown';
  started_at: string;
  duration_ms: number;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender: string;
  receiver: string;
  content: string;
  sent_at: number;
  timer_duration: number;
  expired: number;
  is_photo: number;
  photoData?: string;
  // v1.5
  expires_at?: number | null;
  media_id?: number | null;
  seen?: boolean;  // true if receiver has viewed the message
  message_type?: "opener" | "normal";  // distinguishes message phase
  is_responded_to?: number;  // tracks if opener has been answered
}

export interface TimerState {
  conversation_id: number;
  timer_type: 'opener' | 'response' | 'cooldown';
  started_at: number;
  duration_ms: number;
}

// v1.5 — Social graph
export interface Circle {
  id: number;
  owner_username: string;
  name: string;
  emoji: string;
  created_at: number;
}

export interface Story {
  id: number;
  author_username: string;
  circle_id: number | null;
  media_id: number | null;
  caption: string | null;
  created_at: number;
  expires_at: number;
}

export interface MediaRecord {
  id: number;
  owner_username: string;
  storage_key: string;
  mime: string;
  bytes: number;
  expires_at: number | null;
  encrypted_key: string | null;
  created_at: number;
}
