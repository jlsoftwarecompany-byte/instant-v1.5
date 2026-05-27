import { Message, Friendship, Conversation, TimerState, User } from "../types";

export type WsCallback = (event: any) => void;

class MessageSyncService {
  private socket: WebSocket | null = null;
  private listeners = new Set<WsCallback>();
  private reconnectTimer: any = null;
  private heartbeatTimer: any = null;
  private currentUsername: string | null = null;
  private sessionToken: string | null = null;
  private isConnecting = false;

  constructor() {
    // Single source of truth config connection
  }

  public connect(username?: string, sessionToken?: string) {
    if (username) {
      this.currentUsername = username;
    }
    if (sessionToken) {
      this.sessionToken = sessionToken;
    } else if (username) {
      this.sessionToken = localStorage.getItem("instant-session-token");
    }
    
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      if (this.socket.readyState === WebSocket.OPEN && username && sessionToken) {
        // Already connected, send verify immediately if we got new credentials
        this.send({
          type: "AUTH_VERIFY_SESSION",
          username,
          sessionToken
        });
      }
      return;
    }

    if (this.isConnecting) return;
    this.isConnecting = true;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // Construct dynamic url with fallback
    const wsUrl = `${protocol}//${window.location.host}`;

    console.log(`Connecting Web Socket to: ${wsUrl}`);
    
    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.isConnecting = false;
        console.log("Web Socket Connection established");
        this.startHeartbeat();
        
        // If we are reconnecting, verify immediately
        if (this.currentUsername) {
          if (this.sessionToken) {
            this.send({
              type: "AUTH_VERIFY_SESSION",
              username: this.currentUsername,
              sessionToken: this.sessionToken
            });
          } else {
            this.send({
              type: "VERIFY_USER",
              username: this.currentUsername
            });
          }
        }
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.listeners.forEach(cb => cb(data));
        } catch (e) {
          console.error("Failed parsing message:", e);
        }
      };

      this.socket.onerror = (err) => {
        console.error("Web Socket encountered error:", err);
        this.isConnecting = false;
      };

      this.socket.onclose = () => {
        this.isConnecting = false;
        this.stopHeartbeat();
        console.log("Web Socket connection closed, scheduling auto-reconnect...");
        this.scheduleReconnect();
      };
    } catch (e) {
      this.isConnecting = false;
      console.error("Initialization of Web Socket failed:", e);
      this.scheduleReconnect();
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        // Just empty keep alive ping
        this.socket.send(JSON.stringify({ type: "PING" }));
      }
    }, 25000); // Heartbeat every 25s
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      console.log("Attempting reconnect...");
      this.connect();
    }, 3000); // Reconnect in 3 seconds
  }

  public registerListener(cb: WsCallback) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  public send(payload: any) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    } else {
      console.warn("Socket not open. Message queued or skipped:", payload);
    }
  }

  public disconnect() {
    this.currentUsername = null;
    this.sessionToken = null;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export const wsService = new MessageSyncService();
