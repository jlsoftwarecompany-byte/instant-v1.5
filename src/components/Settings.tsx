import React, { useState } from "react";
import { useTheme } from "./ThemeContext";
import { wsService } from "../lib/ws";
import { User } from "../types";
import { Sun, Moon, Check, UserCheck, ChevronLeft, Save, Star } from "lucide-react";
import { motion } from "motion/react";

interface SettingsProps {
  currentUser: User;
  onBack: () => void;
  onUserUpdate: (updatedUser: User) => void;
  onLogOut: () => void;
}

const LINKER_MASCOTS = [
  { char: "👾", name: "Cyber Retro" },
  { char: "🦊", name: "Neon Fox" },
  { char: "🐱", name: "Cosmic Cat" },
  { char: "⭐", name: "Star Spark" },
  { char: "🐼", name: "Space Panda" },
  { char: "🤖", name: "Techno Bot" },
  { char: "🦄", name: "Magic Unicorn" },
  { char: "🦥", name: "Cyber Sloth" },
  { char: "🦖", name: "Pixel Dino" },
  { char: "🧚", name: "Glowing Fairy" }
];

const LINKER_AURAS = [
  { key: "pink", label: "Neon Pink", class: "bg-[#FE2C55]/25 text-[#FE2C55] border-[#FE2C55]/40 shadow-[0_0_12px_#FE2C55_inset]" },
  { key: "cyan", label: "Vapor Cyan", class: "bg-[#25F4EE]/25 text-[#25F4EE] border-[#25F4EE]/40 shadow-[0_0_12px_#25F4EE_inset]" },
  { key: "purple", label: "Cyber Purple", class: "bg-[#a855f7]/25 text-[#a855f7] border-[#a855f7]/40 shadow-[0_0_12px_#a855f7_inset]" },
  { key: "gold", label: "Gilded Gold", class: "bg-[#eab308]/25 text-[#eab308] border-[#eab308]/40 shadow-[0_0_12px_#eab308_inset]" },
  { key: "green", label: "Acid Green", class: "bg-[#22c55e]/25 text-[#22c55e] border-[#22c55e]/40 shadow-[0_0_12px_#22c55e_inset]" },
  { key: "blue", label: "Hyper Blue", class: "bg-[#3b82f6]/25 text-[#3b82f6] border-[#3b82f6]/40 shadow-[0_0_12px_#3b82f6_inset]" }
];

export const Settings: React.FC<SettingsProps> = ({ currentUser, onBack, onUserUpdate, onLogOut }) => {
  const { theme, toggleTheme } = useTheme();
  const [nickname, setNickname] = useState(currentUser.nickname);
  const [isSaved, setIsSaved] = useState(false);
  const [selectedMascot, setSelectedMascot] = useState(currentUser.linker_avatar || "👾");
  const [selectedAura, setSelectedAura] = useState(currentUser.linker_color || "pink");

  const handleLogOutClick = () => {
    const token = localStorage.getItem("instant-session-token");
    if (token) {
      wsService.send({
        type: "AUTH_LOGOUT",
        sessionToken: token
      });
    }
    onLogOut();
  };

  const handleSaveNickname = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nickname.trim();
    if (trimmed && trimmed.length >= 1 && trimmed.length <= 30) {
      wsService.send({
        type: "NICKNAME_UPDATE",
        nickname: trimmed,
      });

      // Update local storage
      const stored = localStorage.getItem("instant-user");
      if (stored) {
        const parsed = JSON.parse(stored);
        parsed.nickname = trimmed;
        localStorage.setItem("instant-user", JSON.stringify(parsed));
      }

      onUserUpdate({
        ...currentUser,
        nickname: trimmed,
      });

      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    }
  };

  const handleUpdateLinker = (avatar: string, color: string) => {
    setSelectedMascot(avatar);
    setSelectedAura(color);

    wsService.send({
      type: "LINKER_UPDATE",
      avatar,
      color
    });

    // Update local storage
    const stored = localStorage.getItem("instant-user");
    if (stored) {
      const parsed = JSON.parse(stored);
      parsed.linker_avatar = avatar;
      parsed.linker_color = color;
      localStorage.setItem("instant-user", JSON.stringify(parsed));
    }

    onUserUpdate({
      ...currentUser,
      linker_avatar: avatar,
      linker_color: color
    });
  };

  return (
    <div className="flex flex-col min-h-screen bg-[var(--background)] font-sans">
      {/* Top Header */}
      <header className="flex items-center justify-between px-6 py-5 border-b theme-border bg-[var(--background)] sticky top-0 z-40">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-zinc-500 hover:text-pink-500 transition font-black uppercase text-xs cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5 text-pink-500" />
          Inbox
        </button>
        <h1 className="text-lg font-black tracking-widest theme-text-primary uppercase tiktok-gradient-text">
          Customize Center
        </h1>
        <div className="w-16" /> {/* Spacer */}
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-8 space-y-8 pb-20">
        
        {/* Profile Card Summary */}
        <section className="p-6 rounded-3xl theme-card border flex flex-col sm:flex-row items-center gap-6 relative overflow-hidden bg-gradient-to-tr from-[#FE2C55]/5 via-[#a855f7]/5 to-transparent shadow-xl">
          {/* Animated Glow Halo */}
          <div className={`w-20 h-20 rounded-3xl flex items-center justify-center text-4xl shadow-2xl relative shrink-0 transition-all duration-300 transform hover:scale-105 select-none
            ${selectedAura === 'pink' ? 'bg-[#FE2C55]/15 border-2 border-[#FE2C55] shadow-[#FE2C55]/30' : ''}
            ${selectedAura === 'cyan' ? 'bg-[#25F4EE]/15 border-2 border-[#25F4EE] shadow-[#25F4EE]/30' : ''}
            ${selectedAura === 'purple' ? 'bg-[#a855f7]/15 border-2 border-[#a855f7] shadow-[#a855f7]/30' : ''}
            ${selectedAura === 'gold' ? 'bg-[#eab308]/15 border-2 border-[#eab308] shadow-[#eab308]/30' : ''}
            ${selectedAura === 'green' ? 'bg-[#22c55e]/15 border-2 border-[#22c55e] shadow-[#22c55e]/30' : ''}
            ${selectedAura === 'blue' ? 'bg-[#3b82f6]/15 border-2 border-[#3b82f6] shadow-[#3b82f6]/30' : ''}
          `}>
            {selectedMascot}
            {/* Tiny live status aura badge */}
            <span className="absolute -bottom-1.5 -right-1.5 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-4 w-4 bg-[#FE2C55] border-2 border-white dark:border-[#0b0518]"></span>
            </span>
          </div>
          
          <div className="text-center sm:text-left space-y-1 flex-1">
            <h2 className="text-3xl font-black theme-text-primary tracking-tight leading-none uppercase">
              {currentUser.nickname}
            </h2>
            <p className="text-base text-zinc-400 font-bold tracking-wide">
              @{currentUser.username}
            </p>
            <div className="pt-2 flex flex-wrap justify-center sm:justify-start gap-1.5">
              <span className="px-3.5 py-1 bg-gradient-to-r from-yellow-500 to-amber-500 text-zinc-950 font-black text-xs rounded-full uppercase tracking-widest flex items-center justify-center gap-1.5 shadow-lg shadow-yellow-500/10">
                <Star className="w-3.5 h-3.5 fill-current text-zinc-950 animate-bounce" style={{ animationDuration: "1.8s" }} /> 
                {currentUser.links} LINKS
              </span>
              <span className="px-3 py-1 bg-purple-500/15 border border-purple-500/20 text-purple-400 font-black text-[10px] rounded-full uppercase tracking-wider">
                👾 {LINKER_MASCOTS.find(m => m.char === selectedMascot)?.name || "Linker"}
              </span>
            </div>
          </div>
        </section>

        {/* Customize Your Linker Section */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-xs font-black tracking-widest text-[#FE2C55] uppercase flex items-center gap-2">
              <span className="p-1 rounded bg-[#FE2C55]/10 shrink-0 select-none animate-pulse">👾</span> Linkers Companion Avatar
            </h3>
            <p className="text-xs text-zinc-400 font-medium">Your customized Character Companion appears on Chat lists, profiles, and score tables!</p>
          </div>

          <div className="p-6 rounded-3xl theme-card border space-y-6">
            {/* Mascot grids */}
            <div className="space-y-3">
              <span className="block text-[10px] font-black uppercase text-zinc-400 tracking-wider">
                1. Choose Your Companion Character
              </span>
              <div className="grid grid-cols-5 gap-3">
                {LINKER_MASCOTS.map(m => (
                  <button
                    key={m.char}
                    type="button"
                    onClick={() => handleUpdateLinker(m.char, selectedAura)}
                    className={`
                      aspect-square rounded-2xl text-2xl flex flex-col items-center justify-center transition-all duration-200 cursor-pointer border hover:scale-105 active:scale-95
                      ${selectedMascot === m.char 
                        ? 'bg-gradient-to-tr from-[#FE2C55]/10 to-[#a855f7]/10 border-pink-500 shadow-md shadow-pink-500/10' 
                        : 'bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800'
                      }
                    `}
                    title={m.name}
                  >
                    <span>{m.char}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Aura grids */}
            <div className="space-y-3 pt-4 border-t border-purple-500/5">
              <span className="block text-[10px] font-black uppercase text-zinc-400 tracking-wider">
                2. Choose neon Aura outline
              </span>
              <div className="grid grid-cols-3 gap-2">
                {LINKER_AURAS.map(a => (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => handleUpdateLinker(selectedMascot, a.key)}
                    className={`
                      px-3 py-3 rounded-xl border text-[10px] font-black transition-all duration-200 cursor-pointer text-center flex items-center justify-center gap-1 active:scale-98 uppercase tracking-wider
                      ${selectedAura === a.key 
                        ? a.class 
                        : 'bg-zinc-50 dark:bg-zinc-950/40 border-zinc-200 dark:border-zinc-800 text-zinc-400 hover:text-pink-500 hover:border-pink-500/20'
                      }
                    `}
                  >
                    <span>{a.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Display Name Edit section */}
        <section className="space-y-4">
          <h3 className="text-xs font-black tracking-widest text-[#25F4EE] uppercase">
            Edit Nickname
          </h3>
          <form onSubmit={handleSaveNickname} className="p-5 rounded-3xl theme-card border space-y-4">
            <div className="space-y-2">
              <label className="block text-[10px] font-black uppercase text-zinc-400">
                Nickname Display
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Choose a display name"
                required
                maxLength={30}
                className="w-full px-4 py-3.5 rounded-xl border theme-border bg-[var(--background)] font-medium theme-text-primary focus:outline-none focus:ring-1 focus:ring-pink-500 transition"
              />
              <p className="text-xs text-zinc-400">
                This is your visible display name. Make it bold or colorful to stand out!
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={!nickname.trim() || nickname === currentUser.nickname}
                className="px-5 py-3 bg-gradient-to-r from-[#FE2C55] to-[#a855f7] hover:opacity-95 disabled:from-zinc-400/20 disabled:to-zinc-400/30 disabled:text-zinc-500/40 text-white font-extrabold uppercase text-xs tracking-wider rounded-xl transition flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                {isSaved ? (
                  <>
                    <Check className="w-4 h-4" />
                    Saved!
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Nickname
                  </>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* Appearance Settings section */}
        <section className="space-y-4">
          <h3 className="text-xs font-black tracking-widest text-zinc-400 uppercase">
            System Theme
          </h3>
          <div className="p-5 rounded-3xl theme-card border flex items-center justify-between bg-zinc-50/20 dark:bg-zinc-900/10">
            <div className="space-y-1">
              <h4 className="font-bold text-sm theme-text-primary uppercase tracking-wide">Interface Mode</h4>
              <p className="text-xs text-zinc-400">Quickly toggle between Daylight and Cyber Black-Purple.</p>
            </div>
            
            <button
              onClick={toggleTheme}
              className="relative inline-flex h-9 w-16 items-center rounded-full bg-zinc-200 dark:bg-zinc-950 border border-zinc-300 dark:border-purple-950 transition-colors focus:outline-none cursor-pointer"
            >
              <div
                className={`
                  absolute flex items-center justify-center h-7 w-7 rounded-full bg-white dark:bg-zinc-900 transition-transform shadow-md
                  ${theme === "black" ? "translate-x-8" : "translate-x-1"}
                `}
              >
                {theme === "black" ? (
                  <Moon className="w-4 h-4 text-pink-500 fill-pink-500 animate-pulse" />
                ) : (
                  <Sun className="w-4 h-4 text-[#FE2C55]" />
                )}
              </div>
            </button>
          </div>
        </section>

        {/* System Settings Account Summary details */}
        <section className="space-y-4">
          <h3 className="text-xs font-black tracking-widest text-zinc-400 uppercase">
            Identity Card
          </h3>
          <div className="p-5 rounded-3xl theme-card border space-y-3.5 divide-y theme-border bg-zinc-50/20 dark:bg-zinc-900/10">
            <div className="flex justify-between items-center text-sm">
              <span className="text-zinc-400 font-bold uppercase text-[10px]">Permanent Address</span>
              <span className="font-sans font-black theme-text-primary text-base">@{currentUser.username}</span>
            </div>
            <div className="flex justify-between items-center text-sm pt-3.5">
              <span className="text-zinc-400 font-bold uppercase text-[10px]">Star Links Balance</span>
              <span className="font-black text-amber-500 flex items-center gap-1 text-base">
                ⭐ {currentUser.links} links
              </span>
            </div>
            <div className="flex justify-between items-center text-sm pt-3.5">
              <span className="text-zinc-400 font-bold uppercase text-[10px]">Instant Member Since</span>
              <span className="theme-text-primary font-black uppercase text-xs">
                {currentUser.created_at ? new Date(currentUser.created_at).toLocaleDateString() : "Just now"}
              </span>
            </div>
          </div>
        </section>

        {/* Account Controls Section */}
        <section className="space-y-4">
          <h3 className="text-xs font-black tracking-widest text-[#FE2C55] uppercase flex items-center gap-2">
            🔒 Account Controls
          </h3>
          <div className="p-6 rounded-3xl theme-card border theme-border space-y-4 shadow-md bg-[var(--card-bg)]">
            <p className="text-xs text-zinc-400 font-medium">
              You are signed in as <span className="font-semibold theme-text-primary">@{currentUser.username}</span>. Log out to clear your ephemeral session and cached credentials safely.
            </p>
            <button
              onClick={handleLogOutClick}
              className="w-full py-4 bg-rose-500 hover:bg-rose-600 active:scale-98 transition text-white font-bold tracking-wider uppercase text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-rose-500/10"
            >
              Log Out
            </button>
          </div>
        </section>

      </main>
    </div>
  );
};
