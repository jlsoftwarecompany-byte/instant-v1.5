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
  // Two-phase opener/normal economy (Prompt 1)
  phase?: "awaiting_response" | "active";
  opener_initiator?: string | null;
  opener_timer_choice?: number | null;
  // v1.5 — Adaptive Privacy (Strategic Plan §4)
  privacy_mode?: 'standard' | 'ephemeral' | 'anonymous' | 'incognito';
  disappear_after_seconds?: number | null;
  anonymous_mode?: number; // 0 or 1
  // v1.7 — Archive & Revival
  archived?: number; // 0 or 1
  archived_at?: number | null;
  // v1.8 — Permanent save
  saved_permanently?: number; // 0 or 1
  saved_by?: string | null;
  saved_at?: number | null;
}

export interface SavedConversation {
  id: number;
  conversation_id: number;
  participant_1: string;
  participant_2: string;
  saved_by: string;
  saved_at: number;
  // Joined fields from conversations/messages (provided by API)
  other_username?: string;
  other_nickname?: string;
  other_avatar?: string;
  other_color?: string;
  message_count?: number;
}

export interface Timer {
  id: number;
  conversation_id: number;
  timer_type: 'opener' | 'normal' | 'response' | 'cooldown';
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
  timer_type: 'opener' | 'normal' | 'response' | 'cooldown';
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

// v1.8 — Social controls
export interface IgnoredUser {
  id: number;
  ignorer_username: string;
  ignored_username: string;
  created_at: number;
  // Joined from users table
  nickname?: string;
  linker_avatar?: string;
  linker_color?: string;
}

export interface LinkerProfileTarget {
  username: string;
  nickname: string;
  links: number;
  linker_avatar?: string;
  linker_color?: string;
  isFriend: boolean;
  isIgnored: boolean;
}
