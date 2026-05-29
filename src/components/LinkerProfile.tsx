import React, { useState } from "react";
import { ChevronLeft, UserX, EyeOff, Star, MessageSquarePlus, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { wsService } from "../lib/ws";
import { LinkerProfileTarget, User } from "../types";

interface LinkerProfileProps {
  currentUser: User;
  target: LinkerProfileTarget;
  onBack: () => void;
  onActionComplete: () => void; // Called after remove/ignore so parent can refresh
}

export const LinkerProfile: React.FC<LinkerProfileProps> = ({
  currentUser,
  target,
  onBack,
  onActionComplete,
}) => {
  const [isRemoving, setIsRemoving] = useState(false);
  const [isIgnoring, setIsIgnoring] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"remove" | "ignore" | null>(null);
  const [actionDone, setActionDone] = useState<string | null>(null);

  const color = target.linker_color || "pink";

  const colorMap: Record<string, { bg: string; border: string; shadow: string; gradient: string }> = {
    pink:   { bg: "bg-[#FE2C55]/15", border: "border-[#FE2C55]/40", shadow: "shadow-[#FE2C55]/40", gradient: "from-[#FE2C55] to-[#a855f7]" },
    cyan:   { bg: "bg-[#25F4EE]/15", border: "border-[#25F4EE]/40", shadow: "shadow-[#25F4EE]/40", gradient: "from-[#25F4EE] to-[#3b82f6]" },
    purple: { bg: "bg-[#a855f7]/15", border: "border-[#a855f7]/40", shadow: "shadow-[#a855f7]/40", gradient: "from-[#a855f7] to-[#FE2C55]" },
    gold:   { bg: "bg-[#eab308]/15", border: "border-[#eab308]/40", shadow: "shadow-[#eab308]/40", gradient: "from-[#eab308] to-[#FE2C55]" },
    green:  { bg: "bg-[#22c55e]/15", border: "border-[#22c55e]/40", shadow: "shadow-[#22c55e]/40", gradient: "from-[#22c55e] to-[#25F4EE]" },
    blue:   { bg: "bg-[#3b82f6]/15", border: "border-[#3b82f6]/40", shadow: "shadow-[#3b82f6]/40", gradient: "from-[#3b82f6] to-[#a855f7]" },
  };
  const c = colorMap[color] || colorMap.pink;

  const handleRemoveFriend = () => {
    if (isRemoving) return;
    setIsRemoving(true);
    wsService.send({ type: "REMOVE_FRIEND", targetUsername: target.username });
    // Optimistic: close after short delay
    setTimeout(() => {
      setIsRemoving(false);
      setActionDone("Friend removed.");
      setTimeout(() => { onActionComplete(); onBack(); }, 1200);
    }, 600);
  };

  const handleIgnoreUser = () => {
    if (isIgnoring) return;
    setIsIgnoring(true);
    wsService.send({ type: "IGNORE_USER", targetUsername: target.username });
    setTimeout(() => {
      setIsIgnoring(false);
      setActionDone(`@${target.username} ignored. You can unignore them in Settings.`);
      setTimeout(() => { onActionComplete(); onBack(); }, 1800);
    }, 600);
  };

  return (
    <div className="flex flex-col min-h-screen bg-[var(--background)] font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5 border-b theme-border bg-[var(--background)] sticky top-0 z-40">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-zinc-500 hover:text-pink-500 transition font-black uppercase text-xs cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5 text-pink-500" />
          Back
        </button>
        <h1 className="text-lg font-black tracking-widest theme-text-primary uppercase tiktok-gradient-text">
          Linker Profile
        </h1>
        <div className="w-16" />
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-8 space-y-6 pb-12">

        {/* Success toast */}
        {actionDone && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs font-bold text-center"
          >
            {actionDone}
          </motion.div>
        )}

        {/* Profile Card */}
        <section className="flex flex-col items-center text-center p-8 rounded-3xl theme-card border relative overflow-hidden bg-gradient-to-br from-[#FE2C55]/5 via-[#a855f7]/5 to-transparent shadow-xl">
          <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-[#25F4EE] via-[#a855f7] to-[#FE2C55]" />

          {/* Avatar */}
          <div className={`w-28 h-28 rounded-[32px] flex items-center justify-center text-5xl mb-5 border-4 shadow-2xl select-none
            ${c.bg} ${c.border} ${c.shadow}`}
          >
            {target.linker_avatar || "👾"}
          </div>

          {/* Name + username */}
          <h2 className="text-3xl font-black theme-text-primary tracking-tight leading-none uppercase">
            {target.nickname}
          </h2>
          <p className="text-base text-zinc-400 font-bold mt-1 mb-6">@{target.username}</p>

          {/* Links score */}
          <div className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-2">
            <Star className="w-5 h-5 fill-amber-500 text-amber-500" />
            <span className="text-2xl font-black text-amber-500 tabular-nums">{target.links}</span>
            <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">links</span>
          </div>

          {/* Friend status badge */}
          <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border
            ${target.isFriend
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
              : "bg-zinc-500/10 border-zinc-500/20 text-zinc-400"
            }`}
          >
            {target.isFriend ? "✓ Friend" : "Not friends"}
          </span>
        </section>

        {/* Social Action Buttons */}
        <section className="space-y-3">
          <h3 className="text-xs font-black tracking-widest text-zinc-400 uppercase px-1">
            Social Controls
          </h3>

          {/* Remove Friend — only shown if they're a friend */}
          {target.isFriend && !target.isIgnored && (
            confirmAction === "remove" ? (
              <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/5 space-y-3">
                <p className="text-sm font-bold text-zinc-300 text-center">
                  Remove <span className="text-rose-400">@{target.username}</span> as a friend?
                  <br />
                  <span className="text-xs text-zinc-500 font-normal">They can still send you a request again.</span>
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmAction(null)}
                    className="flex-1 py-2.5 rounded-xl border theme-border text-zinc-400 font-black text-xs uppercase tracking-wider transition hover:bg-zinc-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRemoveFriend}
                    disabled={isRemoving}
                    className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-black text-xs uppercase tracking-wider transition hover:bg-rose-600 active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isRemoving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserX className="w-3.5 h-3.5" />}
                    Confirm
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmAction("remove")}
                className="w-full py-3.5 rounded-2xl border border-rose-500/25 bg-rose-500/5 text-rose-400 font-black text-sm flex items-center justify-center gap-2.5 transition hover:bg-rose-500/10 active:scale-98 cursor-pointer"
              >
                <UserX className="w-4.5 h-4.5" />
                Remove Friend
              </button>
            )
          )}

          {/* Ignore User */}
          {!target.isIgnored && (
            confirmAction === "ignore" ? (
              <div className="p-4 rounded-2xl border border-zinc-600/30 bg-zinc-500/5 space-y-3">
                <p className="text-sm font-bold text-zinc-300 text-center">
                  Ignore <span className="text-zinc-200">@{target.username}</span>?
                  <br />
                  <span className="text-xs text-zinc-500 font-normal">They'll be hidden everywhere. They can't send you requests.</span>
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmAction(null)}
                    className="flex-1 py-2.5 rounded-xl border theme-border text-zinc-400 font-black text-xs uppercase tracking-wider transition hover:bg-zinc-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleIgnoreUser}
                    disabled={isIgnoring}
                    className="flex-1 py-2.5 rounded-xl bg-zinc-700 text-zinc-200 font-black text-xs uppercase tracking-wider transition hover:bg-zinc-600 active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isIgnoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <EyeOff className="w-3.5 h-3.5" />}
                    Confirm Ignore
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmAction("ignore")}
                className="w-full py-3.5 rounded-2xl border border-zinc-600/25 bg-zinc-500/5 text-zinc-400 font-black text-sm flex items-center justify-center gap-2.5 transition hover:bg-zinc-500/10 active:scale-98 cursor-pointer"
              >
                <EyeOff className="w-4.5 h-4.5" />
                Ignore User
              </button>
            )
          )}

          {/* Already ignored notice */}
          {target.isIgnored && (
            <div className="p-4 rounded-2xl border border-zinc-700/30 bg-zinc-500/5 text-center">
              <p className="text-xs text-zinc-500 font-bold">
                You are ignoring this user. Unignore them in <span className="text-zinc-300">Settings → Ignored Users</span>.
              </p>
            </div>
          )}
        </section>

      </main>
    </div>
  );
};
