import React, { useState, useEffect, useRef } from "react";
import { Message, TimerState, User } from "../types";
import { wsService } from "../lib/ws";
import {
  Send, ChevronLeft, Clock, ShieldAlert, Image as ImageIcon, Camera,
  Download, Sparkles, Check, Loader2, Star, Zap, Gift
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { MessageBubble } from "./MessageBubble";
import { CameraView } from "./CameraView";
import { compressImage } from "../lib/compress";

interface ChatProps {
  currentUser: User;
  contact: { username: string; nickname: string; links: number; linker_avatar?: string; linker_color?: string };
  conversationId: number;
  initialTimers: TimerState[];
  initialSaved: boolean;
  onBack: () => void;
  onLinksRewardTriggered: (amount: number, reason: string) => void;
}

export const Chat: React.FC<ChatProps> = ({ 
  currentUser, contact, conversationId, initialTimers, initialSaved, onBack, onLinksRewardTriggered 
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [timerDuration, setTimerDuration] = useState<number>(1800000); // 30 mins default
  const [isPhotoSelected, setIsPhotoSelected] = useState<boolean>(false);
  const [selectedPhotoBase64, setSelectedPhotoBase64] = useState<string>("");
  const [showCamera, setShowCamera] = useState<boolean>(false);
  const [isCompressing, setIsCompressing] = useState<boolean>(false);
  
  // Timer States
  const [activeTimer, setActiveTimer] = useState<TimerState | null>(null);
  const [timeLeftMs, setTimeLeftMs] = useState<number>(0);
  const [timerPercentage, setTimerPercentage] = useState<number>(100);

  // Save Status (needed for message bubble state management)
  const [saveStatus, setSaveStatus] = useState<"idle" | "request_sent" | "request_received" | "saved">(
    initialSaved ? "saved" : "idle"
  );

  // Conversation Phase: Opener (waiting for response) or Active (normal messages)
  const [conversationPhase, setConversationPhase] = useState<"awaiting_response" | "active">("awaiting_response");
  const [openerInitiator, setOpenerInitiator] = useState<string | null>(null);
  const [isWaitingForOpenerResponse, setIsWaitingForOpenerResponse] = useState(false);
  const [openerMessageId, setOpenerMessageId] = useState<number | null>(null);
  const [openerTimerChoice, setOpenerTimerChoice] = useState<"10m" | "1hr" | "12hr" | null>(null);

  // Feedback Toast
  const [feedbackToast, setFeedbackToast] = useState<string>("");

  // Photo Fullscreen Viewer
  const [viewerPhoto, setViewerPhoto] = useState<string | null>(null);

  // Track which messages are currently visible in viewport
  const messageVisibilityRef = useRef<Set<number>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load message history and setup subscription listeners
  useEffect(() => {
    // 1. Request history from backend
    wsService.send({
      type: "GET_HISTORY",
      conversationId
    });

    // Mark conversation as read (Trigger 1 Open-Rewards Check)
    wsService.send({
      type: "READ_CONVERSATION",
      conversationId
    });

    // 2. Set active timer if any initial timer exists
    const relevantTimer = initialTimers.find(t => t.conversation_id === conversationId);
    if (relevantTimer) {
      setActiveTimer(relevantTimer);
    }

    const handleWsMessage = (data: any) => {
      switch (data.type) {
        case "HISTORY_SYNC":
          if (data.conversationId === conversationId) {
            setMessages(data.messages);
          }
          break;

        case "CHAT_MESSAGE_BROADCAST":
          if (data.message.conversation_id === conversationId) {
            // Append message
            setMessages(prev => {
              const exists = prev.some(m => m.id === data.message.id);
              if (exists) return prev;
              return [...prev, data.message];
            });

            // Start timer based on sent message
            const newTimer: TimerState = {
              conversation_id: conversationId,
              timer_type: "opener",
              started_at: data.message.sent_at,
              duration_ms: data.message.timer_duration
            };
            setActiveTimer(newTimer);
          }
          break;

        case "MESSAGE_SEEN_BROADCAST":
          if (data.conversationId === conversationId && data.messageId) {
            setMessages(prev =>
              prev.map(msg =>
                msg.id === data.messageId ? { ...msg, seen: true } : msg
              )
            );
          }
          break;

        case "CHAT_DELETED":
          if (data.conversationId === conversationId) {
            triggerToast("Chat deleted — no response in time! 💥");
            setMessages([]);
            setTimeout(() => onBack(), 1800);
          }
          break;

        case "FRIEND_UPDATE": {
          // Keep active timers sync
          const serverTimers = data.timers as TimerState[];
          const currentTimer = serverTimers.find(t => t.conversation_id === conversationId);
          if (currentTimer) {
            setActiveTimer(currentTimer);
          } else {
            setActiveTimer(null);
          }

          // Keep active conversations states sync
          const conv = data.conversations.find((c: any) => c.id === conversationId);
          if (conv && conv.saved === 1) {
            setSaveStatus("saved");
          }
          break;
        }

        case "END_CHAT_REQUEST_BROADCAST":
          if (data.conversationId === conversationId) {
            setSaveStatus("request_received");
            triggerToast(`${contact.nickname} wants to save this conversation`);
          }
          break;

        case "SAVE_TIMER_WARNING":
          if (data.conversationId === conversationId) {
            triggerToast("Warning: 60 seconds remaining to save!");
          }
          break;

        case "CONVERSATION_SAVED_SUCCESS":
          if (data.conversationId === conversationId) {
            setSaveStatus("saved");
            onLinksRewardTriggered(data.finalReward, "Conversation saved successfully");
          }
          break;
      }
    };

    const cleanup = wsService.registerListener(handleWsMessage);
    return () => cleanup();
  }, [conversationId, initialTimers]);

  // Handle live timer ticks
  useEffect(() => {
    if (!activeTimer) {
      setTimeLeftMs(0);
      setTimerPercentage(0);
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const difference = now - activeTimer.started_at;
      const remaining = activeTimer.duration_ms - difference;

      if (remaining <= 0) {
        setTimeLeftMs(0);
        setTimerPercentage(0);
        setActiveTimer(null);
        // Promptly mark older messages as expired locally
        setMessages(prev => prev.map(m => ({ ...m, expired: 1 })));
        clearInterval(interval);
      } else {
        setTimeLeftMs(remaining);
        const percent = Math.max(0, Math.min(100, (remaining / activeTimer.duration_ms) * 100));
        setTimerPercentage(percent);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [activeTimer]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Setup Intersection Observer to detect when messages become visible
  useEffect(() => {
    // Create observer that triggers when a message enters the viewport
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const messageId = parseInt(entry.target.getAttribute('data-message-id') || '0', 10);

          // When message enters viewport (50% visible)
          if (entry.isIntersecting && messageId > 0) {
            // Only mark as seen if:
            // 1. We haven't already marked it
            // 2. We are the receiver (sender.toLowerCase() !== currentUser.username)
            if (!messageVisibilityRef.current.has(messageId)) {
              const message = messages.find(m => m.id === messageId);
              if (message && message.sender.toLowerCase() !== currentUser.username.toLowerCase()) {
                messageVisibilityRef.current.add(messageId);

                // Send MESSAGE_SEEN to server
                wsService.send({
                  type: "MESSAGE_SEEN",
                  conversationId,
                  messageId,
                  seenAt: Date.now()
                });
              }
            }
          }
        });
      },
      { threshold: 0.5 }  // Trigger when 50% of message is visible
    );

    observerRef.current = observer;
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [conversationId, currentUser.username, messages]);

  // Observe message elements
  useEffect(() => {
    if (!observerRef.current) return;

    // Observe all message elements
    const messageElements = document.querySelectorAll('[data-message-id]');
    messageElements.forEach((el) => {
      observerRef.current?.observe(el);
    });

    return () => {
      messageElements.forEach((el) => {
        observerRef.current?.unobserve(el);
      });
    };
  }, [messages]);

  // Detect and update conversation phase based on messages.
  // Robust heuristic that doesn't depend on the backend persisting
  // message_type / is_responded_to: a conversation becomes "active" as soon
  // as BOTH participants have sent at least one message (i.e. the opener was
  // answered). Until then it remains in the opener "awaiting_response" phase.
  useEffect(() => {
    const me = currentUser.username.toLowerCase();
    const them = contact.username.toLowerCase();

    if (messages.length === 0) {
      // No messages yet — current user may send the opener
      setConversationPhase("awaiting_response");
      setOpenerInitiator(currentUser.username);
      setOpenerMessageId(null);
      return;
    }

    const senders = new Set(messages.map(m => m.sender.toLowerCase()));
    const explicitlyResponded = messages.some(
      m => m.message_type === "opener" && m.is_responded_to === 1
    );
    const bothParticipated = senders.has(me) && senders.has(them);

    if (explicitlyResponded || bothParticipated) {
      // Opener has been answered — conversation is live
      setConversationPhase("active");
      setIsWaitingForOpenerResponse(false);
      return;
    }

    // Still in opener phase — exactly one side has spoken
    const opener = messages[0];
    setConversationPhase("awaiting_response");
    setOpenerInitiator(opener.sender);
    setOpenerMessageId(opener.id);

    if (opener.sender.toLowerCase() === me) {
      setIsWaitingForOpenerResponse(true);
    } else {
      setIsWaitingForOpenerResponse(false);
    }

    // Derive the opener timer choice for link-reward display
    if (opener.timer_duration === 600000) setOpenerTimerChoice("10m");
    else if (opener.timer_duration === 3600000) setOpenerTimerChoice("1hr");
    else if (opener.timer_duration === 43200000) setOpenerTimerChoice("12hr");
    else setOpenerTimerChoice(null);
  }, [messages, currentUser.username, contact.username]);

  // Keep the selected timer duration valid for the current phase.
  // Opener presets are 10m/1hr/12hr; active presets are 10s/60s/5m.
  useEffect(() => {
    if (conversationPhase === "awaiting_response" && openerInitiator === currentUser.username) {
      // Opener initiator: default to a valid opener preset
      setTimerDuration(prev =>
        prev === 600000 || prev === 3600000 || prev === 43200000 ? prev : 600000
      );
    } else if (conversationPhase === "active") {
      // Active phase: default to a valid normal-message preset
      setTimerDuration(prev =>
        prev === 10000 || prev === 60000 || prev === 300000 ? prev : 10000
      );
    }
  }, [conversationPhase, openerInitiator, currentUser.username]);

  const triggerToast = (msg: string) => {
    setFeedbackToast(msg);
    setTimeout(() => setFeedbackToast(""), 3000);
  };

  // Convert uploaded image using advanced client-side compression pipeline from 2A
  const handlePhotoUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsCompressing(true);
      try {
        const compressedBase64 = await compressImage(file);
        setSelectedPhotoBase64(compressedBase64);
        setIsPhotoSelected(true);
      } catch (err) {
        console.error("Compression failed", err);
        triggerToast("Failed to compress image");
      } finally {
        setIsCompressing(false);
      }
    }
  };

  // OPENER: Send the initial message that starts the conversation.
  // The initiator picks a 10m / 1hr / 12hr timer; the responder earns
  // 3 / 2 / 1 links when they reply.
  const handleSendOpenerMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    wsService.send({
      type: "CHAT_MESSAGE",
      to: contact.username,
      content: inputText.trim(),
      sentAt: Date.now(),
      timerDuration: timerDuration,
      isPhoto: 0,
      messageType: "opener"
    });

    // Mark local opener phase state
    setIsWaitingForOpenerResponse(true);
    setOpenerInitiator(currentUser.username);
    setOpenerTimerChoice(
      timerDuration === 600000 ? "10m" :
      timerDuration === 3600000 ? "1hr" :
      "12hr"
    );

    setInputText("");
  };

  // OPENER: Respond to an incoming opener — this activates the conversation
  // and awards links to both participants.
  const handleSendOpenerResponse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const linkReward =
      openerTimerChoice === "10m" ? 3 :
      openerTimerChoice === "1hr" ? 2 :
      1;

    // Mark the opener message as responded to locally
    setMessages(prev =>
      prev.map(m =>
        (m.message_type === "opener" || !m.message_type) && m.sender.toLowerCase() !== currentUser.username.toLowerCase()
          ? { ...m, is_responded_to: 1 }
          : m
      )
    );

    // Send the response message (no timer — the response itself activates the chat)
    wsService.send({
      type: "CHAT_MESSAGE",
      to: contact.username,
      content: inputText.trim(),
      sentAt: Date.now(),
      timerDuration: 0,
      isPhoto: 0,
      messageType: "opener",
      isOpenerResponse: 1
    });

    // Notify the backend to award links to both parties.
    // The server replies with LINKS_EARNED (absolute total + reward burst),
    // so we don't award locally here to avoid double-counting.
    wsService.send({
      type: "OPENER_RESPONSE",
      to: contact.username,
      conversationId,
      linksAwarded: linkReward
    });

    // Transition to ACTIVE phase
    setConversationPhase("active");
    setIsWaitingForOpenerResponse(false);
    setInputText("");
  };

  // NORMAL: Send a normal message once the conversation is active.
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() && !isPhotoSelected) return;

    const payload = {
      type: "CHAT_MESSAGE",
      to: contact.username,
      content: isPhotoSelected ? selectedPhotoBase64 : inputText.trim(),
      sentAt: Date.now(),
      timerDuration: timerDuration,
      isPhoto: isPhotoSelected ? 1 : 0,
      photoData: isPhotoSelected ? selectedPhotoBase64 : undefined,
      messageType: "normal"
    };

    wsService.send(payload);

    // Reset inputs
    setInputText("");
    setIsPhotoSelected(false);
    setSelectedPhotoBase64("");
  };

  // Delete the entire conversation when a normal message expires unanswered.
  const handleChatDeletion = () => {
    wsService.send({
      type: "CHAT_EXPIRED_DELETE",
      conversationId,
      conversationUsername: contact.username,
      reason: "NO_RESPONSE_TO_MESSAGE"
    });

    triggerToast("Chat deleted — no response in time! 💥");

    // Return to the inbox after a brief delay
    setTimeout(() => {
      onBack();
    }, 1800);
  };

  // Dedicated websocket sender for in-app captured + compressed cameras
  const handleSendCameraPhoto = (base64PhotoString: string) => {
    const payload = {
      type: "CHAT_MESSAGE",
      to: contact.username,
      content: base64PhotoString,
      sentAt: Date.now(),
      timerDuration: timerDuration,
      isPhoto: 1,
      photoData: base64PhotoString
    };
    wsService.send(payload);
  };

// Download photo to browser / files
  const handleSavePhotoToDevice = () => {
    if (!viewerPhoto) return;
    
    try {
      const link = document.createElement("a");
      link.href = viewerPhoto;
      link.download = `instant_photo_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      triggerToast("Photo saved successfully to your device!");
    } catch (e) {
      triggerToast("Failed to save photo to device");
    }
  };

  const formatTimeRemaining = (ms: number) => {
    if (ms <= 0) return "Expired";
    const totalSecs = Math.ceil(ms / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  // Get timer warning bar values
  const getTimerBarColor = (percent: number) => {
    if (percent > 55) return "bg-[#25F4EE] animate-pulse";
    if (percent > 18) return "bg-amber-500 animate-pulse";
    return "bg-[#FE2C55] animate-ping";
  };

  const contactAvatar = contact.linker_avatar || "👾";
  const contactColor = contact.linker_color || "pink";

  return (
    <div className="flex flex-col h-screen bg-[var(--background)] font-sans relative overflow-hidden">
      
      {/* Dynamic Toast banner feedback */}
      <AnimatePresence>
        {feedbackToast && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="absolute top-20 left-1/2 -translate-x-1/2 px-4 py-2.5 bg-black dark:bg-zinc-950 text-white text-xs font-semibold rounded-full shadow-lg border border-black/20 dark:border-zinc-800 flex items-center gap-2 z-50 whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            {feedbackToast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Header details */}
      <header className="px-5 py-4 border-b theme-border bg-[var(--background)] sticky top-0 z-40 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition text-zinc-500 cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5 text-pink-500" />
          </button>
          
          {/* Dynamic Linker avatar with color aura */}
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-2xl border shrink-0 select-none shadow-sm
            ${contactColor === 'pink' ? 'bg-[#FE2C55]/10 border-[#FE2C55]/30' : ''}
            ${contactColor === 'cyan' ? 'bg-[#25F4EE]/10 border-[#25F4EE]/30' : ''}
            ${contactColor === 'purple' ? 'bg-[#a855f7]/10 border-[#a855f7]/30' : ''}
            ${contactColor === 'gold' ? 'bg-[#eab308]/10 border-[#eab308]/30' : ''}
            ${contactColor === 'green' ? 'bg-[#22c55e]/10 border-[#22c55e]/30' : ''}
            ${contactColor === 'blue' ? 'bg-[#3b82f6]/10 border-[#3b82f6]/30' : ''}
          `}>
            {contactAvatar}
          </div>

          <div>
            <h2 className="font-extrabold text-sm tracking-tight theme-text-primary flex items-center gap-1.5 uppercase leading-none">
              {contact.nickname}
            </h2>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] text-zinc-400 font-bold">@{contact.username}</span>
              <span className="text-[9px] font-black text-amber-500 bg-amber-500/10 px-1.5 py-0.2 rounded uppercase tracking-wider">
                ⭐ {contact.links} LINKS
              </span>
            </div>
          </div>
        </div>

      </header>

      {/* Message List area */}
      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center h-full max-w-xs mx-auto space-y-3">
            <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-900/65 flex items-center justify-center text-zinc-400">
              <Clock className="w-5 h-5 text-pink-500 animate-pulse" />
            </div>
            <p className="text-xs text-zinc-400 font-sans leading-relaxed">
              No messages. Send a message with an expiration timer to get started!
            </p>
          </div>
        ) : (
          messages.map((m, idx) => (
            <MessageBubble
              key={m.id || idx}
              message={m}
              currentUser={currentUser}
              contact={contact}
              saveStatus={saveStatus}
              contactAvatar={contactAvatar}
              onClickPhoto={setViewerPhoto}
              onExplodeComplete={(msgId) => {
                setMessages(prev => {
                  const exploded = prev.find(msg => msg.id === msgId);
                  // If a normal message expires and nothing was sent after it,
                  // the conversation is abandoned → delete the entire chat.
                  if (
                    exploded &&
                    conversationPhase === "active" &&
                    (exploded.message_type === "normal" || !exploded.message_type)
                  ) {
                    const hasLaterMessage = prev.some(msg => msg.sent_at > exploded.sent_at);
                    if (!hasLaterMessage) {
                      handleChatDeletion();
                    }
                  }
                  return prev.map(msg => msg.id === msgId ? { ...msg, expired: 1 } : msg);
                });
              }}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Message Composer — Conditional by Conversation Phase */}
      {saveStatus !== "saved" && (
        <>
          {conversationPhase === "awaiting_response" && openerInitiator === currentUser.username ? (
            /* ───────── OPENER PHASE — INITIATOR VIEW ───────── */
            <div className="p-4 border-t theme-border bg-[var(--background)] sticky bottom-0 z-40">
              <div className="mb-4 bg-gradient-to-r from-pink-500/10 to-purple-500/10 dark:from-pink-500/20 dark:to-purple-500/20 p-4 rounded-2xl border border-pink-500/30 dark:border-purple-500/30">
                <h3 className="text-xs font-black tracking-widest uppercase text-pink-500 mb-3 flex items-center gap-1.5">
                  <Zap className="w-4 h-4 animate-pulse" /> Start Conversation
                </h3>

                {/* Opener Timer Selection — 3 Options */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[
                    { label: "10 min", val: 600000, links: 3 },
                    { label: "1 hour", val: 3600000, links: 2 },
                    { label: "12 hours", val: 43200000, links: 1 }
                  ].map(opt => (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() => setTimerDuration(opt.val)}
                      disabled={isWaitingForOpenerResponse}
                      className={`
                        px-3 py-2.5 text-[9px] font-black rounded-lg transition duration-150 border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
                        ${timerDuration === opt.val
                          ? "bg-gradient-to-r from-[#FE2C55] to-[#a855f7] border-transparent text-white shadow-md scale-105"
                          : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300 hover:text-pink-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                        }
                      `}
                    >
                      {opt.label}
                      <br />
                      <span className="text-[8px] text-amber-500 font-black">+{opt.links} ⭐</span>
                    </button>
                  ))}
                </div>

                <span className="text-[9px] text-zinc-400 font-medium">
                  Choose how long they have to respond. You'll earn the same number of links they do.
                </span>
              </div>

              {isWaitingForOpenerResponse ? (
                /* Waiting Status — input locked until a response arrives */
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs font-bold">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Waiting for their response...
                </div>
              ) : (
                /* Opener Input */
                <form onSubmit={handleSendOpenerMessage} className="space-y-3">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Write your opening message..."
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl border theme-border bg-[var(--background)] text-[var(--foreground)] font-medium text-sm focus:outline-none focus:ring-1 focus:ring-pink-500 resize-none"
                  />
                  <button
                    type="submit"
                    disabled={!inputText.trim()}
                    className="w-full py-3 bg-gradient-to-r from-[#FE2C55] to-[#a855f7] hover:opacity-95 disabled:from-zinc-400/20 disabled:to-zinc-400/30 disabled:text-zinc-500/40 text-white font-extrabold uppercase text-xs tracking-wider rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-md"
                  >
                    <Send className="w-4 h-4" />
                    Send Opener
                  </button>
                </form>
              )}
            </div>

          ) : conversationPhase === "awaiting_response" && openerInitiator !== currentUser.username ? (
            /* ───────── OPENER PHASE — RESPONDER VIEW ───────── */
            <div className="p-4 border-t theme-border bg-[var(--background)] sticky bottom-0 z-40">
              <div className="mb-4 p-4 bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 dark:from-emerald-500/20 dark:to-cyan-500/20 rounded-2xl border border-emerald-500/30 dark:border-cyan-500/30">
                <h3 className="text-xs font-black tracking-widest uppercase text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-1.5">
                  <Gift className="w-4 h-4 animate-bounce" /> Earn {openerTimerChoice === "10m" ? 3 : openerTimerChoice === "1hr" ? 2 : 1} Links
                </h3>
                <p className="text-[9px] text-zinc-500 dark:text-zinc-400">
                  Respond to this opener to activate the conversation and earn links.
                </p>
              </div>

              {/* Response Input */}
              <form onSubmit={handleSendOpenerResponse} className="space-y-3">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Write your response to start chatting..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border theme-border bg-[var(--background)] text-[var(--foreground)] font-medium text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="w-full py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:opacity-95 disabled:from-zinc-400/20 disabled:to-zinc-400/30 disabled:text-zinc-500/40 text-white font-extrabold uppercase text-xs tracking-wider rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-md"
                >
                  <Send className="w-4 h-4" />
                  Respond &amp; Activate
                </button>
              </form>
            </div>

          ) : (
            /* ───────── ACTIVE PHASE — NORMAL MESSAGES ───────── */
            <form onSubmit={handleSendMessage} className="p-4 border-t theme-border bg-[var(--background)] sticky bottom-0 z-40">

              {/* Temporary Photo attachment preview widget */}
              {isPhotoSelected && (
                <div className="mb-3.5 p-2 border border-pink-500/20 bg-pink-500/5 rounded-xl flex items-center justify-between select-none animate-in fade-in zoom-in duration-200">
                  <div className="flex items-center gap-2">
                    <img
                      src={selectedPhotoBase64}
                      alt="Attachment preview"
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 object-cover rounded-lg border border-pink-500/20"
                    />
                    <div className="text-left">
                      <p className="text-[10px] font-black text-pink-500 uppercase tracking-widest">Photo Captured</p>
                      <p className="text-xs text-zinc-400">Ready to transmit in real time</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setIsPhotoSelected(false); setSelectedPhotoBase64(""); }}
                    className="text-xs text-zinc-400 hover:text-rose-500 font-bold px-2 py-1 cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              )}

              {/* Message Timer — Normal Presets (10s / 60s / 5m) */}
              <div className="mb-4 bg-zinc-50/50 dark:bg-zinc-900/40 p-3 rounded-2xl border theme-border">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[10px] font-black tracking-widest text-[var(--foreground)] opacity-75 uppercase flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-pink-500 animate-pulse" /> Message Timer:
                  </span>
                  <span className="px-2 py-0.5 text-xs font-black rounded-lg bg-pink-500/15 text-pink-500 border border-pink-500/20 shadow-xs animate-pulse">
                    {(() => {
                      const s = Math.round(timerDuration / 1000);
                      if (s < 60) return `${s}s`;
                      const m = Math.floor(s / 60);
                      const rem = s % 60;
                      return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
                    })()}
                  </span>
                </div>

                {/* Three Timer Preset Buttons */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "10s 🔥", val: 10000 },
                    { label: "60s", val: 60000 },
                    { label: "5m", val: 300000 }
                  ].map(opt => (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() => setTimerDuration(opt.val)}
                      className={`
                        px-2.5 py-2 text-[9px] font-black rounded-lg transition duration-150 border cursor-pointer
                        ${timerDuration === opt.val
                          ? "bg-gradient-to-r from-[#FE2C55] to-[#a855f7] border-transparent text-white shadow-md scale-105"
                          : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300 hover:text-pink-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                        }
                      `}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subtle Compression indicator */}
              {isCompressing && (
                <div className="mb-2 p-2 bg-pink-500/5 border border-pink-500/20 text-xs font-black text-pink-500 animate-pulse flex items-center gap-2 rounded-xl">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Compressing...
                </div>
              )}

              <div className="flex items-center gap-2">

                {/* Gallery Upload file button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-3.5 rounded-xl border theme-border bg-black/5 dark:bg-zinc-900 hover:bg-black/10 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:text-pink-500 transition flex items-center justify-center shadow-xs shrink-0 cursor-pointer"
                  title="Upload Photo File"
                >
                  <ImageIcon className="w-5 h-5" />
                </button>

                {/* Custom In-App Camera capture snap button */}
                <button
                  type="button"
                  onClick={() => setShowCamera(true)}
                  className="p-3.5 rounded-xl border theme-border bg-[#FE2C55]/5 text-[#FE2C55] hover:bg-[#FE2C55]/10 border-pink-500/20 transition flex items-center justify-center shadow-xs shrink-0 cursor-pointer"
                  title="In-App Camera Capture"
                >
                  <Camera className="w-5 h-5" />
                </button>

                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handlePhotoUploadChange}
                  className="hidden"
                />

                {!isPhotoSelected && (
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 px-4 py-3.5 rounded-xl border theme-border bg-[var(--background)] font-sans text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-pink-500 transition"
                  />
                )}

                {isPhotoSelected && (
                  <input
                    type="text"
                    disabled
                    placeholder="Press send to transmit the selected photo attachment"
                    className="flex-1 px-4 py-3.5 rounded-xl border theme-border bg-[#FE2C55]/5 text-[#FE2C55] font-medium italic text-sm"
                  />
                )}

                <button
                  type="submit"
                  disabled={(!inputText.trim() && !isPhotoSelected)}
                  className="p-3.5 bg-gradient-to-r from-[#FE2C55] to-[#a855f7] hover:opacity-95 disabled:from-zinc-400/20 disabled:to-zinc-400/30 disabled:text-zinc-500/40 text-white rounded-xl transition flex items-center justify-center shadow-lg shadow-pink-500/5 shrink-0 cursor-pointer active:scale-95"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {/* In-App Camera capturing stream overlay */}
      <AnimatePresence>
        {showCamera && (
          <CameraView 
            onSend={handleSendCameraPhoto} 
            onClose={() => setShowCamera(false)} 
          />
        )}
      </AnimatePresence>

      {/* Fullscreen interactive Image Viewer modal */}
      <AnimatePresence>
        {viewerPhoto && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col justify-between p-6 cursor-zoom-out"
            onClick={() => setViewerPhoto(null)}
          >
            {/* Visual Header */}
            <div className="flex items-center justify-between w-full select-none" onClick={e => e.stopPropagation()}>
              <h3 className="text-white text-sm font-bold tracking-tight">Fullscreen Viewer</h3>
              <button
                onClick={() => setViewerPhoto(null)}
                className="text-zinc-200 hover:text-white px-3 py-1 bg-black/40 dark:bg-zinc-900 border border-white/10 rounded-lg text-xs cursor-pointer hover:bg-black/60 dark:hover:bg-zinc-800 transition"
              >
                Close Viewer
              </button>
            </div>

            {/* Img element */}
            <div className="flex-1 flex items-center justify-center p-4">
              <img 
                src={viewerPhoto} 
                alt="Enlarged visualization" 
                referrerPolicy="no-referrer"
                className="max-h-[70vh] max-w-full object-contain rounded-xl border border-zinc-805 select-none shadow-[0_0_50px_rgba(254,44,85,0.2)]" 
              />
            </div>

            {/* Device Save action */}
            <div className="w-full max-w-xs mx-auto flex flex-col gap-2 pb-6" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={handleSavePhotoToDevice}
                className="w-full py-4 bg-gradient-to-r from-[#FE2C55] to-[#a855f7] text-white font-extrabold uppercase text-xs tracking-wider rounded-xl shadow-lg flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <Download className="w-5 h-5 animate-bounce" /> Save to Device
              </button>
              <p className="text-[10px] text-zinc-500 text-center uppercase tracking-widest leading-relaxed">
                Requires photos / storage permissions (Granted)
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};
