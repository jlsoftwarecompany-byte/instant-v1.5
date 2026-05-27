/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { ThemeProvider, useTheme } from "./components/ThemeContext";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { LoginScreen } from "./components/LoginScreen";
import { Onboarding } from "./components/Onboarding";
import { Inbox } from "./components/Inbox";
import { Chat } from "./components/Chat";
import { Settings } from "./components/Settings";
import { Profile } from "./components/Profile";
import { LinkerGenerator } from "./components/LinkerGenerator";
import { ParticleBurst } from "./components/ParticleBurst";
import { wsService } from "./lib/ws";
import { User, Friendship, Conversation, TimerState } from "./types";
import { RefreshCw, Signal, SignalZero, WifiOff } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Web Push base64 formatting helper
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Push subscription registration trigger
async function registerPushNotifications(username: string) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("Push notifications are not supported in this browser environment.");
    return;
  }

  // Gracefully handle pre-denied notifications
  if (typeof Notification !== "undefined" && Notification.permission === "denied") {
    console.info("Push notifications are blocked or denied. This is expected when running inside a development iframe.");
    return;
  }

  try {
    // Request permission if not yet decided
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          console.info("Push notifications permission was not granted by the user.");
          return;
        }
      } catch (err) {
        console.info("Notification permission request bypassed or restricted in this browsing frame context.");
        return;
      }
    }

    const reg = await navigator.serviceWorker.register("/sw.js");
    console.log("Service Worker registered on server context.");

    const res = await fetch("/api/vapid-public-key");
    const { publicKey } = await res.json();
    if (!publicKey) {
      console.warn("No public VAPID key is configured on server.");
      return;
    }

    // Force subscribe client
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await fetch("/api/save-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        subscription
      })
    });
    console.log("User's push subscription registered with sqlite index!");
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    if (errMsg.includes("permission denied") || errMsg.includes("denied") || err?.name === "SecurityError") {
      console.info(
        "Push notifications subscription declined or restricted in this environment (e.g., development browser iframe sandbox)."
      );
    } else {
      console.warn("Optional push registration was bypassed or encountered an environment limit:", errMsg);
    }
  }
}

function MainApp() {
  const { theme } = useTheme();

  // Core authenticated states
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(true);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  // Synchronization indexes mapping
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, { nickname: string; links: number; linker_avatar?: string; linker_color?: string }>>({});
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [timers, setTimers] = useState<TimerState[]>([]);
  const [discoverUsers, setDiscoverUsers] = useState<{ username: string; nickname: string; links: number; linker_avatar?: string; linker_color?: string }[]>([]);

  // Screens and view parameters
  const [view, setView] = useState<"welcome" | "login" | "onboarding" | "inbox" | "chat" | "settings" | "profile" | "generator">("welcome");
  const [activeChatFriend, setActiveChatFriend] = useState<{ username: string; nickname: string; links: number } | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);

  // Link burst animation trigger overlays
  const [rewardBurst, setRewardBurst] = useState<{ amount: number; reason: string } | null>(null);

  // Initial reconnect checks on startup
  useEffect(() => {
    const sessionToken = localStorage.getItem("instant-session-token");
    const storedUser = localStorage.getItem("instant-user");
    let initialUsername: string | null = null;
    if (storedUser) {
      try {
        initialUsername = JSON.parse(storedUser).username;
      } catch (e) {}
    }
    if (!initialUsername) {
      initialUsername = localStorage.getItem("instant-username");
    }

    // 1. Establish initial WS connect mapping
    if (initialUsername && sessionToken) {
      wsService.connect(initialUsername, sessionToken);
    } else {
      wsService.connect();
      setIsVerifying(false);
      setView("welcome");
    }

    // Setup global state syncing channel listeners
    const handleWsEvent = (data: any) => {
      switch (data.type) {
        case "PING":
          // Empty pong response managed internally by browser WS
          break;

        case "AUTH_SUCCESS":
          setIsVerifying(false);
          if (data.user) {
            setCurrentUser(data.user);
            localStorage.setItem("instant-user", JSON.stringify(data.user));
            localStorage.setItem("instant-session-token", data.sessionToken);
            localStorage.setItem("instant-username", data.user.username);
            setView("inbox");
            setIsConnected(true);
            
            // Try and register Web push
            registerPushNotifications(data.user.username);
          }
          break;

        case "AUTH_SESSION_EXPIRED":
          setIsVerifying(false);
          localStorage.removeItem("instant-user");
          localStorage.removeItem("instant-session-token");
          localStorage.removeItem("instant-username");
          setCurrentUser(null);
          setView("welcome");
          break;

        case "VERIFY_USER_RESPONSE":
          setIsVerifying(false);
          if (data.success && data.user) {
            setCurrentUser(data.user);
            localStorage.setItem("instant-user", JSON.stringify(data.user));
            setView("inbox");
            setIsConnected(true);
            
            // Try and register Web push
            registerPushNotifications(data.user.username);
          } else {
            // Outdated storage session -> Drop user back to step 1
            localStorage.removeItem("instant-user");
            setCurrentUser(null);
            setView("welcome");
          }
          break;

        case "REGISTER_SUCCESS":
          setCurrentUser(data.user);
          localStorage.setItem("instant-user", JSON.stringify(data.user));
          setView("inbox");
          setIsConnected(true);

          registerPushNotifications(data.user.username);
          break;

        case "FRIEND_UPDATE":
          setFriendships(data.friendships || []);
          setUsersMap(data.users || {});
          setConversations(data.conversations || []);
          setTimers(data.timers || []);
          setDiscoverUsers(data.discoverUsers || []);
          break;

        case "LINKS_EARNED":
          // Overlay gold burst particle animation instantly
          setRewardBurst({
            amount: data.amount,
            reason: data.reason
          });
          
          // Refresh user links total count
          if (currentUser) {
            setCurrentUser(prev => prev ? { ...prev, links: data.links } : null);
            
            // Refresh info in storage
            const stored = localStorage.getItem("instant-user");
            if (stored) {
              const parsed = JSON.parse(stored);
              parsed.links = data.links;
              localStorage.setItem("instant-user", JSON.stringify(parsed));
            }
          }
          break;

        case "NICKNAME_UPDATED":
          // Change nickname locally if matches target
          setUsersMap(prev => {
            const copy = { ...prev };
            if (copy[data.username]) {
              copy[data.username].nickname = data.nickname;
            }
            return copy;
          });
          if (currentUser && currentUser.username.toLowerCase() === data.username.toLowerCase()) {
            setCurrentUser(prev => prev ? { ...prev, nickname: data.nickname } : null);
          }
          break;
      }
    };

    const cleanup = wsService.registerListener(handleWsEvent);
    return () => cleanup();
  }, [currentUser?.username]);

  // Handle live WebSocket online status checking
  useEffect(() => {
    const monitorInterval = setInterval(() => {
      // Connect check helper
      const isSocketOpen = (wsService as any).socket?.readyState === WebSocket.OPEN;
      setIsConnected(isSocketOpen);
    }, 1500);

    return () => clearInterval(monitorInterval);
  }, []);

  const handleOnboardingComplete = (newUser: User) => {
    setCurrentUser(newUser);
    setView("inbox");
  };

  const handleLogOut = () => {
    localStorage.removeItem("instant-user");
    localStorage.removeItem("instant-session-token");
    localStorage.removeItem("instant-username");
    setCurrentUser(null);
    setView("welcome");
    wsService.disconnect();
    wsService.connect();
  };

  const handleTriggerLinksRewardOverlay = (amount: number, reason: string) => {
    setRewardBurst({ amount, reason });
  };

  // Convert friendships list into simple contacts models list
  const getFriendsListModels = () => {
    if (!currentUser) return [];
    
    const accepted = friendships.filter(f => f.status === "accepted");
    return accepted.map(f => {
      const companion = f.requester_username.toLowerCase() === currentUser.username.toLowerCase()
        ? f.receiver_username.toLowerCase()
        : f.requester_username.toLowerCase();
      
      const details = usersMap[companion] || { nickname: companion, links: 0, linker_avatar: '👾', linker_color: 'pink' };
      return {
        username: companion,
        nickname: details.nickname,
        links: details.links,
        linker_avatar: details.linker_avatar,
        linker_color: details.linker_color
      };
    });
  };

  if (isVerifying && currentUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--background)] font-sans">
        <div className="flex flex-col items-center space-y-4">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
          <p className="text-sm font-semibold text-zinc-400 uppercase tracking-widest animate-pulse">
            Verifying Session...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] transition-colors duration-200">
      
      {/* Top Banner Online status checking row */}
      {currentUser && (
        <div className="w-full bg-zinc-950 text-white text-[10px] uppercase font-extrabold tracking-wider px-6 py-1 flex items-center justify-between border-b border-zinc-900 sticky top-0 z-50">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-ping" />
            <span>INSTANT PWA</span>
          </div>

          <div className="flex items-center gap-1.5 font-bold">
            {isConnected ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-emerald-500 font-sans">Server Connected</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                <span className="text-rose-500 font-sans">Reconnecting...</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Burst Reward Animation Overlay */}
      <AnimatePresence>
        {rewardBurst && (
          <ParticleBurst
            amount={rewardBurst.amount}
            reason={rewardBurst.reason}
            onComplete={() => setRewardBurst(null)}
          />
        )}
      </AnimatePresence>

      {/* Screen Views router */}
      {view === "welcome" && (
        <WelcomeScreen
          onCreateAccount={() => setView("onboarding")}
          onLogIn={() => setView("login")}
        />
      )}

      {view === "login" && (
        <LoginScreen
          onLoginSuccess={(user, token) => {
            setCurrentUser(user);
            localStorage.setItem("instant-user", JSON.stringify(user));
            localStorage.setItem("instant-session-token", token);
            localStorage.setItem("instant-username", user.username);
            setView("inbox");
            setIsConnected(true);
            registerPushNotifications(user.username);
          }}
          onBackToWelcome={() => setView("welcome")}
          isConnected={isConnected}
        />
      )}

      {view === "onboarding" && (
        <Onboarding 
          onOnboardingComplete={handleOnboardingComplete} 
          isConnected={isConnected}
        />
      )}

      {view === "inbox" && currentUser && (
        <Inbox
          currentUser={currentUser}
          friendshipsList={friendships}
          allUsersMap={usersMap}
          activeConversations={conversations}
          timersList={timers}
          discoverUsers={discoverUsers}
          onOpenChat={(friend, convId) => {
            setActiveChatFriend(friend);
            setActiveConversationId(convId);
            setView("chat");
          }}
          onOpenSettings={() => setView("settings")}
          onOpenProfile={() => setView("profile")}
          onOpenGenerator={() => setView("generator")}
          onLogOut={handleLogOut}
        />
      )}

      {view === "chat" && currentUser && activeChatFriend && activeConversationId && (
        <Chat
          currentUser={currentUser}
          contact={activeChatFriend}
          conversationId={activeConversationId}
          initialTimers={timers}
          initialSaved={conversations.find(c => c.id === activeConversationId)?.saved === 1}
          onBack={() => {
            setView("inbox");
            setActiveChatFriend(null);
            setActiveConversationId(null);
          }}
          onLinksRewardTriggered={handleTriggerLinksRewardOverlay}
        />
      )}

      {view === "settings" && currentUser && (
        <Settings
          currentUser={currentUser}
          onBack={() => setView("inbox")}
          onUserUpdate={(updated) => setCurrentUser(updated)}
          onLogOut={handleLogOut}
        />
      )}

      {view === "profile" && currentUser && (
        <Profile
          currentUser={currentUser}
          friendsList={getFriendsListModels()}
          onBack={() => setView("inbox")}
          onOpenGenerator={() => setView("generator")}
        />
      )}

      {view === "generator" && currentUser && (
        <LinkerGenerator
          currentUser={currentUser}
          onBack={() => setView("profile")}
          onUserUpdate={(updated) => setCurrentUser(updated)}
        />
      )}

    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <MainApp />
    </ThemeProvider>
  );
}
