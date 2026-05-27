import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Message, User } from "../types";
import { Image as ImageIcon, Camera } from "lucide-react";
import { ParticleBurst } from "./ParticleBurst";

interface MessageBubbleProps {
  message: Message;
  currentUser: User;
  contact: { username: string; nickname: string; links: number; linker_avatar?: string; linker_color?: string };
  saveStatus: "idle" | "request_sent" | "request_received" | "saved";
  contactAvatar: string;
  onClickPhoto: (src: string) => void;
  onExplodeComplete?: (messageId: number) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  currentUser,
  contact,
  saveStatus,
  contactAvatar,
  onClickPhoto,
  onExplodeComplete,
}) => {
  const isMe = message.sender.toLowerCase() === currentUser.username;
  const isPhoto = message.is_photo === 1;

  // Determine static initial state
  const isSaved = saveStatus === "saved";
  const endTime = message.sent_at + message.timer_duration;

  const [stage, setStage] = useState<"active" | "flash" | "exploding" | "expired">(() => {
    if (isSaved) return "active";
    // Check if finished
    const isAlreadyExpired = Date.now() >= endTime;
    return isAlreadyExpired ? "expired" : "active";
  });

  const bubbleRef = useRef<HTMLDivElement>(null);
  const explosionTriggered = useRef(false);

  useEffect(() => {
    if (stage !== "active" || isSaved) return;

    let animId: number;
    const bubbleEl = bubbleRef.current;

    const tick = () => {
      const now = Date.now();
      const timeLeft = endTime - now;

      if (timeLeft <= 0) {
        if (!explosionTriggered.current) {
          explosionTriggered.current = true;
          // Trigger Stage 1: Flash (0ms - 150ms)
          setStage("flash");

          // Stage 2: Explosion (150ms - 600ms)
          const explodeTimeout = setTimeout(() => {
            setStage("exploding");
          }, 150);

          // Stage 3: Ash state (600ms+)
          const ashTimeout = setTimeout(() => {
            setStage("expired");
            if (onExplodeComplete) {
              onExplodeComplete(message.id);
            }
          }, 600);

          return () => {
            clearTimeout(explodeTimeout);
            clearTimeout(ashTimeout);
          };
        }
        return;
      }

      // Compute bubble color interpolations
      const percent = (timeLeft / message.timer_duration) * 100;
      const isDark = document.documentElement.classList.contains("dark");
      
      const neutral = isMe 
        ? { r: 254, g: 44, b: 85 } // Tiktok pinkish (#FE2C55)
        : (isDark ? { r: 24, g: 24, b: 27 } : { r: 244, g: 244, b: 245 }); // zinc-900 / zinc-100

      const orange = { r: 249, g: 115, b: 22 };   // #f97316
      const deepRed = { r: 153, g: 27, b: 27 };   // #991b1b
      const brightRed = { r: 239, g: 68, b: 68 }; // #ef4444

      let r = neutral.r;
      let g = neutral.g;
      let b = neutral.b;

      if (percent >= 60) {
        r = neutral.r; g = neutral.g; b = neutral.b;
      } else if (percent >= 30) {
        const ratio = (60 - percent) / 30;
        r = Math.round(neutral.r + ratio * (orange.r - neutral.r));
        g = Math.round(neutral.g + ratio * (orange.g - neutral.g));
        b = Math.round(neutral.b + ratio * (orange.b - neutral.b));
      } else if (percent >= 10) {
        const ratio = (30 - percent) / 20;
        r = Math.round(orange.r + ratio * (deepRed.r - orange.r));
        g = Math.round(orange.g + ratio * (deepRed.g - orange.g));
        b = Math.round(orange.b + ratio * (deepRed.b - orange.b));
      } else if (percent >= 1) {
        const ratio = (10 - percent) / 9;
        r = Math.round(deepRed.r + ratio * (brightRed.r - deepRed.r));
        g = Math.round(deepRed.g + ratio * (brightRed.g - deepRed.g));
        b = Math.round(deepRed.b + ratio * (brightRed.b - deepRed.b));
      } else {
        r = brightRed.r; g = brightRed.g; b = brightRed.b;
      }

      if (bubbleEl) {
        bubbleEl.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
        // For me, it's a gradient initially at >= 60%
        if (isMe && percent >= 60) {
          bubbleEl.style.backgroundColor = "";
        }
        
        // Handle receiver text legibility as it darkens past 60%
        if (!isMe) {
          if (percent < 60) {
            bubbleEl.style.color = "#ffffff";
            bubbleEl.style.borderColor = "transparent";
          } else {
            bubbleEl.style.color = "";
            bubbleEl.style.borderColor = "";
          }
        }
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [stage, message, isMe, endTime, isSaved, onExplodeComplete]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      className={`flex ${isMe ? "justify-end" : "justify-start"} relative w-full`}
    >
      <div className={`max-w-[80%] flex flex-col ${isMe ? "items-end" : "items-start"}`}>
        
        {stage === "expired" ? (
          /* Expired / Ash Residue State */
          <div className="px-4 py-3 bg-[var(--background)] text-zinc-400 border border-zinc-200 dark:border-zinc-800 rounded-2xl italic text-sm opacity-60">
            [ Message Expired ]
          </div>
        ) : isPhoto ? (
          /* Photo Attachment Layout (which ALSO fuses/explodes identical to text) */
          <motion.div
            ref={bubbleRef}
            animate={
              stage === "flash"
                ? { scale: 1.08 }
                : stage === "exploding"
                  ? { scale: 0, opacity: 0 }
                  : { scale: 1 }
            }
            transition={{
              duration: stage === "flash" ? 0.15 : stage === "exploding" ? 0.45 : 0.2,
              ease: "easeInOut"
            }}
            className="relative group overflow-hidden border border-zinc-200 dark:border-zinc-800 rounded-2xl bg-zinc-100 dark:bg-zinc-900 p-1"
          >
            <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur-xs text-[9px] text-white font-bold rounded-sm flex items-center gap-1 z-10 select-none">
              <ImageIcon className="w-2.5 h-2.5 text-pink-500 animate-pulse" />
              PHOTO ATTACHMENT
            </div>
            <img 
              src={message.content} 
              alt="Photo attachment" 
              referrerPolicy="no-referrer"
              className="w-48 h-48 object-cover rounded-xl cursor-zoom-in hover:brightness-95 transition pointer-events-auto"
              onClick={() => onClickPhoto(message.content)}
            />
            <button 
              type="button"
              onClick={() => onClickPhoto(message.content)}
              className="w-full mt-1.5 py-1 text-[10px] font-bold text-center theme-text-primary hover:text-pink-500 flex items-center justify-center gap-1 cursor-pointer"
            >
              <Camera className="w-3 h-3 text-pink-500" /> Open Viewer
            </button>
          </motion.div>
        ) : (
          /* Standard Bubble Layout with Fuse Timer */
          <motion.div
            ref={bubbleRef}
            animate={
              stage === "flash"
                ? { scale: 1.08 }
                : stage === "exploding"
                  ? { scale: 0, opacity: 0 }
                  : { scale: 1 }
            }
            transition={{
              duration: stage === "flash" ? 0.15 : stage === "exploding" ? 0.45 : 0.2,
              ease: "easeInOut"
            }}
            style={stage === "flash" ? { backgroundColor: "rgb(239, 68, 68)", color: "#ffffff" } : undefined}
            className={`
              px-4 py-3 rounded-2xl text-sm font-medium leading-relaxed font-sans shadow-md transition-colors relative
              ${isMe 
                ? "bg-gradient-to-tr from-[#FE2C55] to-[#a855f7] text-white rounded-br-xs border border-pink-500/10 shadow-pink-500/5" 
                : "bg-zinc-100 dark:bg-zinc-900 theme-text-primary rounded-bl-xs border theme-border"
              }
            `}
          >
            {message.content}
          </motion.div>
        )}

        {/* Mascot marker metadata */}
        <span className="text-[9px] text-zinc-400 mt-1 tracking-wider uppercase font-black flex items-center gap-1 select-none">
          <span>{isMe ? (currentUser.linker_avatar || "👾") : contactAvatar}</span>
          <span>
            {isMe ? "You" : contact.nickname} • {new Date(message.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </span>

      </div>

      {/* Render local ParticleBurst if on exploding stage */}
      {stage === "exploding" && (
        <ParticleBurst 
          mode="explosion" 
          onComplete={() => {}} 
        />
      )}
    </motion.div>
  );
};
