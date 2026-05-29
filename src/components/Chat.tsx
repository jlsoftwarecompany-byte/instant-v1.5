import React, { useState, useEffect, useRef } from "react";
import { Message, TimerState, User } from "../types";
import { wsService } from "../lib/ws";
import {
  Send, ChevronLeft, Clock, ShieldAlert, Image as ImageIcon, Camera,
  Download, Sparkles, Check, Loader2, Star
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
  // Hot potato: when the latest timer expires, every bubble explodes at once.
  const [detonating, setDetonating] = useState<boolean>(false);
  const detonatingRef = useRef<boolean>(false);

  // Save Status (needed for message bubble state management)
  const [saveStatus, setSaveStatus] = useState<"idle" | "request_sent" | "request_received" | "saved">(
    initialSaved ? "saved" : "idle"
  );

  // Conversation Phase (server-authoritative): "awaiting_response" while an opener
  // is outstanding (or none sent yet) or "active" once the opener has been answered.
  const [conversationPhase, setConversationPhase] = useState<"awaiting_response" | "active">("awaiting_response");
  const [openerInitiator, setOpenerInitiator] = useState<string | null>(null);
  const [openerTimerChoice, setOpenerTimerChoice] = useState<number | null>(null);

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
            setConversationPhase(data.phase || "awaiting_response");
            setOpenerInitiator(data.openerInitiator ?? null);
            setOpenerTimerChoice(data.openerTimerChoice ?? null);
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

            // Sync server-authoritative phase state carried with the broadcast
            if (data.phase) setConversationPhase(data.phase);
            setOpenerInitiator(data.openerInitiator ?? null);
            if (data.openerTimerChoice !== undefined) setOpenerTimerChoice(data.openerTimerChoice);

            // Hot potato: each new message REPLACES the running timer with a
            // fresh one of its own duration. Only the latest message's timer
            // counts down — respond before it expires or the whole chat dies.
            const isOpener = data.message.message_type === "opener";
            setActiveTimer({
              conversation_id: conversationId,
              timer_type: isOpener ? "opener" : "normal",
              started_at: data.message.sent_at,
              duration_ms: data.message.timer_duration
            });
          }
          break;

        case "CHAT_DELETED":
          if (data.conversationId === conversationId) {
            // A normal message went unanswered — the chat was permanently wiped.
            // If we're mid-detonation, let the explosion animation finish and let
            // the detonation effect handle the wipe; otherwise clear immediately.
            setActiveTimer(null);
            setConversationPhase("awaiting_response");
            setOpenerInitiator(null);
            setOpenerTimerChoice(null);
            if (!detonatingRef.current) {
              setMessages([]);
              messageVisibilityRef.current.clear();
              triggerToast("Chat expired — messages were permanently deleted");
            }
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
          if (conv) {
            if (conv.saved === 1) setSaveStatus("saved");
            if (conv.phase) setConversationPhase(conv.phase);
            setOpenerInitiator(conv.opener_initiator ? String(conv.opener_initiator).toLowerCase() : null);
            setOpenerTimerChoice(conv.opener_timer_choice ?? null);
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
        // Hot potato: the latest message's timer ran out unanswered, so the
        // WHOLE conversation explodes. Detonate every bubble at once, then ask
        // the server to delete the chat (the server timer monitor is the
        // authoritative fallback; this just makes it feel instant). Opener
        // expiry only resets the opener and never deletes.
        if (activeTimer.timer_type === "normal") {
          detonatingRef.current = true;
          setDetonating(true);
          triggerToast("Time's up — the conversation exploded.");
          wsService.send({ type: "CHAT_EXPIRED_DELETE", conversationId });
        } else {
          setMessages(prev => prev.map(m => ({ ...m, expired: 1 })));
        }
        clearInterval(interval);
      } else {
        setTimeLeftMs(remaining);
        const percent = Math.max(0, Math.min(100, (remaining / activeTimer.duration_ms) * 100));
        setTimerPercentage(percent);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [activeTimer]);

  // Hot potato: once detonation starts, let every bubble play its explosion
  // (~600ms) then wipe the conversation locally and reset to the opener phase.
  useEffect(() => {
    if (!detonating) return;
    const t = setTimeout(() => {
      setMessages([]);
      messageVisibilityRef.current.clear();
      setConversationPhase("awaiting_response");
      setOpenerInitiator(null);
      setOpenerTimerChoice(null);
      detonatingRef.current = false;
      setDetonating(false);
    }, 800);
    return () => clearTimeout(t);
  }, [detonating]);

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

  // Keep the composer's default timer sensible for the current phase: openers
  // default to 10m, everything else (responses / normal messages) to 60s.
  useEffect(() => {
    const canOpen = conversationPhase === "awaiting_response" && !openerInitiator;
    setTimerDuration(canOpen ? 600000 : 60000);
  }, [conversationPhase, openerInitiator]);

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

  // Whether the next message is a brand-new opener (awaiting phase + no outstanding opener).
  const isOpenerTurn = conversationPhase === "awaiting_response" && !openerInitiator;
  // The initiator is locked out until their opener gets a response.
  const isWaitingForResponse =
    conversationPhase === "awaiting_response" &&
    !!openerInitiator &&
    openerInitiator === currentUser.username.toLowerCase();

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (isWaitingForResponse) return;
    if (!inputText.trim() && !isPhotoSelected) return;

    const payload = {
      type: "CHAT_MESSAGE",
      to: contact.username,
      content: isPhotoSelected ? selectedPhotoBase64 : inputText.trim(),
      sentAt: Date.now(),
      timerDuration: timerDuration,
      isPhoto: isPhotoSelected ? 1 : 0,
      photoData: isPhotoSelected ? selectedPhotoBase64 : undefined,
      messageType: isOpenerTurn ? "opener" : "normal"
    };

    wsService.send(payload);

    // Reset inputs
    setInputText("");
    setIsPhotoSelected(false);
    setSelectedPhotoBase64("");
  };

  // Dedicated websocket sender for in-app captured + compressed cameras
  const handleSendCameraPhoto = (base64PhotoString: string) => {
    if (isWaitingForResponse) return;
    const payload = {
      type: "CHAT_MESSAGE",
      to: contact.username,
      content: base64PhotoString,
      sentAt: Date.now(),
      timerDuration: timerDuration,
      isPhoto: 1,
      photoData: base64PhotoString,
      messageType: isOpenerTurn ? "opener" : "normal"
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
      <header className="px-4 py-3 border-b theme-border bg-[var(--background)] sticky top-0 z-40 flex items-center justify-between shadow-xs">
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
      <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-3 sm:space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center h-full max-w-xs mx-auto space-y-3">
            <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-900/65 flex items-center justify-center text-zinc-400">
              <Clock className="w-5 h-5 text-pink-500 animate-pulse" />
            </div>
            <p className="text-xs text-zinc-400 font-sans leading-relaxed">
              {isOpenerTurn
                ? "Send an opener with a 10m, 1hr or 12hr timer. When they reply, you both earn links."
                : "No messages yet."}
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
              // Hot potato: only the latest message runs/shows its countdown;
              // earlier messages are frozen (timer paused & hidden). When the
              // chat detonates, every bubble explodes at once.
              isLatest={idx === messages.length - 1}
              forceExplode={detonating}
              onExplodeComplete={(msgId) => {
                setMessages(prev => prev.map(msg => msg.id === msgId ? { ...msg, expired: 1 } : msg));
              }}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Initiator is locked out until their opener gets a response */}
      {saveStatus !== "saved" && isWaitingForResponse && (
        <div className="p-4 border-t theme-border bg-[var(--background)] sticky bottom-0 z-40">
          <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 text-amber-500">
            <Clock className="w-4 h-4 animate-pulse shrink-0" />
            <span className="text-xs font-black uppercase tracking-wider text-center">
              Waiting for {contact.nickname} to respond to your opener…
            </span>
          </div>
        </div>
      )}

      {/* Bottom Message Composer */}
      {saveStatus !== "saved" && !isWaitingForResponse && (
        <form onSubmit={handleSendMessage} className="p-3 border-t theme-border bg-[var(--background)] sticky bottom-0 z-40 overflow-x-hidden">

          {/* Responder hint while answering an opener */}
          {conversationPhase === "awaiting_response" && !isOpenerTurn && (
            <div className="mb-3 px-3 py-2 rounded-xl border border-[#25F4EE]/20 bg-[#25F4EE]/5 text-[11px] font-bold text-cyan-500 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              Reply to start the chat — you both earn {openerTimerChoice ? (openerTimerChoice === 600000 ? 3 : openerTimerChoice === 3600000 ? 2 : 1) : 1} link{(openerTimerChoice === 600000 ? 3 : openerTimerChoice === 3600000 ? 2 : 1) === 1 ? "" : "s"}.
            </div>
          )}

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

          {/* Message Expiry Timer — phase-aware presets */}
          <div className="mb-4 bg-zinc-50/50 dark:bg-zinc-900/40 p-3 rounded-2xl border theme-border">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[10px] font-black tracking-widest text-[var(--foreground)] opacity-75 uppercase flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-pink-500 animate-pulse" />
                {isOpenerTurn ? "Opener Timer:" : "Reply Expiry:"}
              </span>
              <span className="px-2 py-0.5 text-xs font-black rounded-lg bg-pink-500/15 text-pink-500 border border-pink-500/20 shadow-xs animate-pulse">
                {(() => {
                  const s = Math.round(timerDuration / 1000);
                  if (s < 60) return `${s}s`;
                  const m = Math.floor(s / 60);
                  if (m < 60) { const rem = s % 60; return rem === 0 ? `${m}m` : `${m}m ${rem}s`; }
                  const h = Math.floor(m / 60); const remM = m % 60;
                  return remM === 0 ? `${h}h` : `${h}h ${remM}m`;
                })()}
              </span>
            </div>

            {!isOpenerTurn && (
              <p className="text-[9px] text-rose-500 font-bold mb-2 uppercase tracking-wide">
                ⚠ If this timer runs out unanswered, the whole chat is deleted.
              </p>
            )}

            {/* Timer Preset Buttons — openers (10m/1hr/12hr) vs normal (10s/60s/5m) */}
            <div className={`grid gap-2 ${isOpenerTurn ? "grid-cols-3" : "grid-cols-3"}`}>
              {(isOpenerTurn
                ? [
                    { label: "10m · +3", val: 600000 },
                    { label: "1hr · +2", val: 3600000 },
                    { label: "12hr · +1", val: 43200000 }
                  ]
                : [
                    { label: "10s 🔥", val: 10000 },
                    { label: "60s", val: 60000 },
                    { label: "5m", val: 300000 }
                  ]
              ).map(opt => (
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

          <div className="flex items-center gap-1.5 overflow-x-auto">

            {/* Gallery Upload file button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-3 rounded-lg border theme-border bg-black/5 dark:bg-zinc-900 hover:bg-black/10 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:text-pink-500 transition flex items-center justify-center shadow-xs shrink-0 cursor-pointer"
              title="Upload Photo File"
            >
              <ImageIcon className="w-5 h-5" />
            </button>

            {/* Custom In-App Camera capture snap button */}
            <button
              type="button"
              onClick={() => setShowCamera(true)}
              className="p-3 rounded-lg border theme-border bg-[#FE2C55]/5 text-[#FE2C55] hover:bg-[#FE2C55]/10 border-pink-500/20 transition flex items-center justify-center shadow-xs shrink-0 cursor-pointer"
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
                placeholder="Type and choose expiration time..."
                className="flex-1 px-3 py-3 rounded-xl border theme-border bg-[var(--background)] font-sans text-sm theme-text-primary focus:outline-none focus:ring-1 focus:ring-pink-500 transition min-w-0"
              />
            )}

            {isPhotoSelected && (
              <input
                type="text"
                disabled
                placeholder="Press send to transmit the selected photo attachment"
                className="flex-1 px-3 py-3 rounded-xl border theme-border bg-[#FE2C55]/5 text-[#FE2C55] font-medium italic text-sm min-w-0"
              />
            )}

            <button
              type="submit"
              disabled={(!inputText.trim() && !isPhotoSelected)}
              className="p-3 bg-gradient-to-r from-[#FE2C55] to-[#a855f7] hover:opacity-95 disabled:from-zinc-400/20 disabled:to-zinc-400/30 disabled:text-zinc-500/40 text-white rounded-xl transition flex items-center justify-center shadow-lg shadow-pink-500/5 shrink-0 cursor-pointer active:scale-95"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </form>
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
