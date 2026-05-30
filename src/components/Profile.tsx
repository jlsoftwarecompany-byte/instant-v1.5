import React from "react";
import { User } from "../types";
import { ChevronLeft, Award, Flame, Medal, Sparkles } from "lucide-react";

interface ProfileProps {
  currentUser: User;
  friendsList: { username: string; nickname: string; links: number; linker_avatar?: string; linker_color?: string }[];
  onBack: () => void;
  onOpenGenerator: () => void;
}

export const Profile: React.FC<ProfileProps> = ({ currentUser, friendsList, onBack, onOpenGenerator }) => {
  // Rank contacts by link totals for Top Connections
  const topConnections = [...friendsList]
    .sort((a, b) => b.links - a.links)
    .slice(0, 5);

  const myAvatar = currentUser.linker_avatar || "👾";
  const myColor = currentUser.linker_color || "pink";

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
          Linkers Profile
        </h1>
        <div className="w-16" />
      </header>

      {/* Profile Main Container */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-8 space-y-8 pb-12">
        
        {/* Profile Card */}
        <section className="p-6 rounded-3xl theme-card border flex flex-col sm:flex-row items-center gap-6 relative overflow-hidden bg-gradient-to-tr from-[#FE2C55]/5 via-[#a855f7]/5 to-transparent shadow-xl">
          <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-[#25F4EE] via-[#a855f7] to-[#FE2C55]" />

          {/* Avatar with aura */}
          <div className={`w-20 h-20 rounded-3xl flex items-center justify-center text-4xl shadow-2xl relative shrink-0 select-none
            ${myColor === 'pink' ? 'bg-[#FE2C55]/15 border-2 border-[#FE2C55] shadow-[#FE2C55]/30' : ''}
            ${myColor === 'cyan' ? 'bg-[#25F4EE]/15 border-2 border-[#25F4EE] shadow-[#25F4EE]/30' : ''}
            ${myColor === 'purple' ? 'bg-[#a855f7]/15 border-2 border-[#a855f7] shadow-[#a855f7]/30' : ''}
            ${myColor === 'gold' ? 'bg-[#eab308]/15 border-2 border-[#eab308] shadow-[#eab308]/30' : ''}
            ${myColor === 'green' ? 'bg-[#22c55e]/15 border-2 border-[#22c55e] shadow-[#22c55e]/30' : ''}
            ${myColor === 'blue' ? 'bg-[#3b82f6]/15 border-2 border-[#3b82f6] shadow-[#3b82f6]/30' : ''}
          `}>
            {myAvatar}
            <span className="absolute -bottom-1.5 -right-1.5 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-4 w-4 bg-[#FE2C55] border-2 border-white dark:border-[#0b0518]"></span>
            </span>
          </div>

          <div className="text-center sm:text-left space-y-1 flex-1">
            <h2 className="text-3xl font-black theme-text-primary tracking-tight leading-none uppercase">
              {currentUser.nickname}
            </h2>
            <p className="text-base text-zinc-400 font-bold tracking-wide">@{currentUser.username}</p>

            <div className="pt-2 flex flex-wrap justify-center sm:justify-start gap-2">
              {/* Spendable balance — silver chain */}
              <span className="px-3 py-1 bg-zinc-700/30 border border-zinc-500/30 text-zinc-200 font-black text-xs rounded-full uppercase tracking-wider flex items-center gap-1.5">
                🔗 {currentUser.links} links
              </span>
              {/* All-time total — gold chain */}
              <span className="px-3 py-1 border font-black text-xs rounded-full uppercase tracking-wider flex items-center gap-1.5"
                style={{ background: "rgba(251,191,36,0.1)", borderColor: "rgba(251,191,36,0.3)" }}>
                <span>⛓️</span>
                <span style={{ background: "linear-gradient(90deg,#fbbf24,#f59e0b,#fcd34d)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  {currentUser.all_time_links ?? 0} all-time
                </span>
              </span>
            </div>
          </div>
        </section>

        {/* Generate Linker Presets button */}
        <div className="flex justify-center">
          <button
            onClick={onOpenGenerator}
            className="px-5 py-2 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/25 text-[#a855f7] dark:text-purple-300 font-extrabold text-[10px] tracking-widest rounded-full uppercase transition-all duration-200 shadow-md hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-pink-500 animate-pulse" />
            Generate Linker Presets 🎲
          </button>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950/40 border theme-border flex flex-col items-center shadow-xs">
            <span className="text-[10px] text-zinc-400 font-black uppercase tracking-wider mb-1">
              Connections
            </span>
            <span className="text-3xl font-black text-pink-500">
              {friendsList.length}
            </span>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950/40 border theme-border flex flex-col items-center shadow-xs">
            <span className="text-[10px] text-zinc-400 font-black uppercase tracking-wider mb-1">
              All-time links
            </span>
            <span className="text-3xl font-black text-amber-500">
              ⛓️ {currentUser.all_time_links ?? 0}
            </span>
          </div>
        </div>

        {/* Streaks and Badges */}
        <section className="space-y-4">
          <h3 className="text-xs font-black tracking-widest text-[#25F4EE] uppercase">
            🏆 Achievement unlocked
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {/* Streak Level 1 Badge */}
            <div className="flex flex-col items-center text-center p-4 rounded-2xl theme-card border relative overflow-hidden">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 
                ${currentUser.links >= 1 ? "bg-amber-500/10 text-amber-500 border border-amber-500/20 shadow-xs" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400/40"}`}>
                <Flame className="w-6 h-6 fill-current animate-pulse" />
              </div>
              <span className="text-xs font-black theme-text-primary uppercase leading-none">First Flame</span>
              <span className="text-[9px] text-zinc-400 mt-1 uppercase font-bold">Earn 1 link</span>
            </div>

            {/* Streak Level 2 Badge */}
            <div className="flex flex-col items-center text-center p-4 rounded-2xl theme-card border relative overflow-hidden">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 
                ${currentUser.links >= 10 ? "bg-orange-500/10 text-orange-500 border border-orange-500/20 shadow-xs" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400/40"}`}>
                <Medal className="w-6 h-6 animate-pulse" />
              </div>
              <span className="text-xs font-black theme-text-primary uppercase leading-none">Conversalist</span>
              <span className="text-[9px] text-zinc-400 mt-1 uppercase font-bold">Earn 10 links</span>
            </div>

            {/* Streak Level 3 Badge */}
            <div className="flex flex-col items-center text-center p-4 rounded-2xl theme-card border relative overflow-hidden">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 
                ${currentUser.links >= 50 ? "bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 shadow-xs" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400/40"}`}>
                <Award className="w-6 h-6 animate-pulse" />
              </div>
              <span className="text-xs font-black theme-text-primary uppercase leading-none">Legendary</span>
              <span className="text-[9px] text-zinc-400 mt-1 uppercase font-bold">Earn 50 links</span>
            </div>
          </div>
        </section>

        {/* Top Connections List */}
        <section className="space-y-4">
          <h3 className="text-xs font-black tracking-widest text-[#a855f7] uppercase">
            👑 Top Friends Leaderboard
          </h3>
          <div className="rounded-3xl theme-card border divide-y theme-border overflow-hidden bg-[var(--card-bg)] shadow-md">
            {topConnections.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-400 uppercase font-bold tracking-wider">
                Start making connections to see them listed here!
              </div>
            ) : (
              topConnections.map((conn, idx) => {
                const friendAvatar = conn.linker_avatar || "👾";
                const friendAura = conn.linker_color || "pink";
                const goldDotsCount = Math.min(5, Math.max(1, Math.ceil(conn.links / 5)));
                return (
                  <div key={conn.username} className="p-4 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-950/60 transition-colors">
                    <div className="flex items-center gap-3">
                      {/* Interactive friend Avatar representation */}
                      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-2xl border shadow-sm select-none
                        ${friendAura === 'pink' ? 'bg-[#FE2C55]/10 border-[#FE2C55]/30' : ''}
                        ${friendAura === 'cyan' ? 'bg-[#25F4EE]/10 border-[#25F4EE]/30' : ''}
                        ${friendAura === 'purple' ? 'bg-[#a855f7]/10 border-[#a855f7]/30' : ''}
                        ${friendAura === 'gold' ? 'bg-[#eab308]/10 border-[#eab308]/30' : ''}
                        ${friendAura === 'green' ? 'bg-[#22c55e]/10 border-[#22c55e]/30' : ''}
                        ${friendAura === 'blue' ? 'bg-[#3b82f6]/10 border-[#3b82f6]/30' : ''}
                      `}>
                        {friendAvatar}
                      </div>
                      <div>
                        <h4 className="font-extrabold text-sm theme-text-primary uppercase leading-none">
                          {conn.nickname}
                        </h4>
                        <p className="text-xs text-zinc-400 font-bold mt-1">
                          @{conn.username}
                        </p>
                      </div>
                    </div>
                    
                    {/* Glowing link count indicator */}
                    <div className="flex flex-col items-end gap-1.5" title={`${conn.links} links`}>
                      <span className="text-xs font-black text-amber-500 flex items-center gap-0.5">
                        ⭐ {conn.links}
                      </span>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: goldDotsCount }).map((_, dIdx) => (
                          <span key={dIdx} className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b] shrink-0" />
                        ))}
                        {Array.from({ length: 5 - goldDotsCount }).map((_, dIdx) => (
                          <span key={dIdx} className="w-2 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 shrink-0" />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

      </main>
    </div>
  );
};
