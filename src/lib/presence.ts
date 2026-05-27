/**
 * Live Presence helpers (Strategic Plan §4 — Live Presence).
 * Thin wrapper over wsService that publishes typed presence updates.
 */
import { wsService } from "./ws";

export type PresenceStatus =
  | { kind: "online" }
  | { kind: "studying"; subject?: string }
  | { kind: "gaming"; game?: string }
  | { kind: "listening"; track?: string; artist?: string }
  | { kind: "live"; roomId?: string }
  | { kind: "away" };

export function publishPresence(status: PresenceStatus) {
  wsService.send({ type: "PRESENCE_UPDATE", status });
}

export function subscribePresence(cb: (username: string, status: PresenceStatus) => void) {
  return wsService.registerListener((event: any) => {
    if (event?.type === "PRESENCE_BROADCAST" && event.username && event.status) {
      cb(event.username, event.status);
    }
  });
}
