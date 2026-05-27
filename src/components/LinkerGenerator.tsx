import React, { useState, useEffect } from "react";
import { User } from "../types";
import { wsService } from "../lib/ws";
import { ChevronLeft, Sparkles, RefreshCw, Check, Star, ShieldAlert } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface LinkerGeneratorProps {
  currentUser: User;
  onBack: () => void;
  onUserUpdate: (updatedUser: User) => void;
}

interface ProceduralLinker {
  id: string;
  avatar: string;
  color: string;
  title: string;
  trait: string;
  resonanceScore: number;
}

const EMOLIS = [
  "👾", "🦊", "🐱", "⭐", "🐼", "🤖", "🦄", "🦥", "🦖", "🧚", 
  "🐵", "🐙", "👻", "👽", "🧙", "🤠", "🐸", "🦉", "🦋", "🐉", 
  "🦁", "🐯", "🐻", "🐨", "🐸", "🐹", "🐰", "🦊", "🦝", "🐱"
];

const COLORS = ["pink", "cyan", "purple", "gold", "green", "blue"];

const PREFIXES = [
  "Cyber", "Vapor", "Neon", "Hyper", "Astral", "Retro", "Cosmic", 
  "Glitch", "Pixel", "Quantum", "Acid", "Digital", "Void", "Spectral",
  "Solar", "Luna", "Static", "Omega", "Matrix", "Hologram"
];

const NOUNS = [
  "Wanderer", "Drifter", "Guardian", "Ranger", "Pioneer", "Enforcer", 
  "Glider", "Sorcerer", "Glitcher", "Spectre", "Beast", "Starlight", 
  "Shifter", "Resonator", "Striker", "Sentinel", "Avenger", "Rebel"
];

const TRAITS = [
  "Speeds up response time tracking",
  "Boosts daily connection streaks",
  "Double Neon visual resonance",
  "High efficiency conversational flow",
  "Cosmic aura link bonus stabilizer",
  "Sub-space text transmission focus",
  "Pulsing message energy booster"
];

export const LinkerGenerator: React.FC<LinkerGeneratorProps> = ({ currentUser, onBack, onUserUpdate }) => {
  const [generatedLinkers, setGeneratedLinkers] = useState<ProceduralLinker[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const generateRandomLinkers = () => {
    setIsGenerating(true);
    
    // Simulate high-tech compilation delay
    setTimeout(() => {
      const list: ProceduralLinker[] = [];
      for (let i = 0; i < 6; i++) {
        const randEmoji = EMOLIS[Math.floor(Math.random() * EMOLIS.length)];
        const randColor = COLORS[Math.floor(Math.random() * COLORS.length)];
        const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
        const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
        const trait = TRAITS[Math.floor(Math.random() * TRAITS.length)];
        const resonance = Math.floor(Math.random() * 51) + 50; // 50-100%

        list.push({
          id: `${i}_${Date.now()}_${Math.random()}`,
          avatar: randEmoji,
          color: randColor,
          title: `${prefix} ${noun}`,
          trait,
          resonanceScore: resonance
        });
      }
      setGeneratedLinkers(list);
      setIsGenerating(false);
    }, 600);
  };

  useEffect(() => {
    generateRandomLinkers();
  }, []);

  const handleEquipLinker = (avatar: string, color: string, title: string) => {
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

    // Inform App level user update
    onUserUpdate({
      ...currentUser,
      linker_avatar: avatar,
      linker_color: color
    });

    setSuccessMessage(`Equipped ${title} successfully!`);
    setTimeout(() => setSuccessMessage(""), 3000);
  };

  return (
    <div className="flex flex-col min-h-screen bg-[var(--background)] font-sans">
      
      {/* Lab Header */}
      <header className="flex items-center justify-between px-6 py-5 border-b theme-border bg-[var(--background)] sticky top-0 z-40">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-zinc-500 hover:text-pink-500 transition font-black uppercase text-xs cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5 text-pink-500" />
          Back
        </button>
        <h1 className="text-lg font-black tracking-widest theme-text-primary uppercase tiktok-gradient-text flex items-center gap-1.5">
          <Sparkles className="w-5 h-5 text-pink-500 animate-pulse" /> Linker Generator Lab
        </h1>
        <div className="w-16" />
      </header>

      {/* Main Panel Content */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-8 space-y-8 pb-20">
        
        {/* Banner with brief instructions */}
        <div className="rounded-3xl theme-card border border-pink-500/10 p-6 bg-gradient-to-br from-[#FE2C55]/5 via-[#25F4EE]/5 to-transparent relative overflow-hidden flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1.5">
            <h2 className="text-sm font-black text-pink-500 uppercase tracking-wider flex items-center gap-1.5">
              Procedural Character Forge
            </h2>
            <p className="text-xs text-zinc-400 font-bold leading-relaxed max-w-lg">
              Forge and select specialized visual presets. Clicking "Adopt" immediately synchronizes your new companion avatar, customizable aura, and aesthetic across the entire Linkers network.
            </p>
          </div>
          
          <button
            onClick={generateRandomLinkers}
            disabled={isGenerating}
            className="px-4 py-2.5 bg-gradient-to-r from-[#FE2C55] to-[#a855f7] hover:opacity-95 text-white text-xs font-black uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-1.5 shadow-md shrink-0 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isGenerating ? "animate-spin" : ""}`} />
            Re-Roll Preset Set
          </button>
        </div>

        {/* Status indicator toast feedback alert */}
        <AnimatePresence>
          {successMessage && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="p-4 rounded-xl text-center text-xs font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 uppercase tracking-widest flex items-center justify-center gap-2"
            >
              <Check className="w-4 h-4" />
              {successMessage}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Custom Generator Board layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {generatedLinkers.map((linker) => {
            const isEquipped = currentUser.linker_avatar === linker.avatar && currentUser.linker_color === linker.color;
            return (
              <motion.div
                key={linker.id}
                whileHover={{ scale: 1.02 }}
                className={`p-5 rounded-3xl theme-card border relative overflow-hidden flex flex-col justify-between h-56 transition-all shadow-md
                  ${linker.color === "pink" ? "border-[#FE2C55]/20 hover:border-[#FE2C55]/50 bg-gradient-to-b from-[#FE2C55]/5 via-transparent to-transparent" : ""}
                  ${linker.color === "cyan" ? "border-[#25F4EE]/20 hover:border-[#25F4EE]/50 bg-gradient-to-b from-[#25F4EE]/5 via-transparent to-transparent" : ""}
                  ${linker.color === "purple" ? "border-[#a855f7]/20 hover:border-[#a855f7]/50 bg-gradient-to-b from-[#a855f7]/5 via-transparent to-transparent" : ""}
                  ${linker.color === "gold" ? "border-[#eab308]/20 hover:border-[#eab308]/50 bg-gradient-to-b from-[#eab308]/5 via-transparent to-transparent" : ""}
                  ${linker.color === "green" ? "border-[#22c55e]/20 hover:border-[#22c55e]/50 bg-gradient-to-b from-[#22c55e]/5 via-transparent to-transparent" : ""}
                  ${linker.color === "blue" ? "border-[#3b82f6]/20 hover:border-[#3b82f6]/50 bg-gradient-to-b from-[#3b82f6]/5 via-transparent to-transparent" : ""}
                `}
              >
                {/* Visual Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-3xl border shadow-sm select-none
                      ${linker.color === "pink" ? "bg-[#FE2C55]/15 border-[#FE2C55]/30 shadow-[#FE2C55]/10" : ""}
                      ${linker.color === "cyan" ? "bg-[#25F4EE]/15 border-[#25F4EE]/30 shadow-[#25F4EE]/10" : ""}
                      ${linker.color === "purple" ? "bg-[#a855f7]/15 border-[#a855f7]/30 shadow-[#a855f7]/10" : ""}
                      ${linker.color === "gold" ? "bg-[#eab308]/15 border-[#eab308]/30 shadow-[#eab308]/10" : ""}
                      ${linker.color === "green" ? "bg-[#22c55e]/15 border-[#22c55e]/30 shadow-[#22c55e]/10" : ""}
                      ${linker.color === "blue" ? "bg-[#3b82f6]/15 border-[#3b82f6]/30 shadow-[#3b82f6]/10" : ""}
                    `}>
                      {linker.avatar}
                    </div>
                    <div>
                      <h4 className="font-extrabold text-sm theme-text-primary uppercase tracking-tight">
                        {linker.title}
                      </h4>
                      <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mt-0.5">
                        Aura: <span className="theme-text-primary capitalize">{linker.color}</span>
                      </p>
                    </div>
                  </div>

                  <span className={`px-2 py-0.5 font-bold uppercase tracking-wider text-[9px] rounded-md
                    ${linker.color === "pink" ? "bg-[#FE2C55]/10 text-[#FE2C55]" : ""}
                    ${linker.color === "cyan" ? "bg-[#25F4EE]/10 text-[#25F4EE]" : ""}
                    ${linker.color === "purple" ? "bg-[#a855f7]/10 text-[#a855f7]" : ""}
                    ${linker.color === "gold" ? "bg-[#eab308]/10 text-[#eab308]" : ""}
                    ${linker.color === "green" ? "bg-[#22c55e]/10 text-[#22c55e]" : ""}
                    ${linker.color === "blue" ? "bg-[#3b82f6]/10 text-[#3b82f6]" : ""}
                  `}>
                    🛡️ Core
                  </span>
                </div>

                {/* Trait & stats section */}
                <div className="py-2.5 text-left border-t border-b theme-border my-2.5">
                  <span className="text-[9px] text-zinc-400 font-black uppercase tracking-widest block mb-0.5">Procedural Skill</span>
                  <p className="text-xs text-zinc-500 dark:text-zinc-300 font-medium leading-none flex items-center gap-1 italic">
                    ⭐ {linker.trait}
                  </p>
                </div>

                {/* Action button */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-zinc-400">
                    <span>RESONANCE:</span>
                    <span className="text-amber-500 font-black">{linker.resonanceScore}%</span>
                  </div>

                  {isEquipped ? (
                    <button
                      disabled
                      className="px-3.5 py-1.5 bg-emerald-500/10 border border-emerald-500/25 text-emerald-500 text-xs font-black uppercase tracking-wider rounded-xl flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" /> Equipped
                    </button>
                  ) : (
                    <button
                      onClick={() => handleEquipLinker(linker.avatar, linker.color, linker.title)}
                      className={`
                        px-3.5 py-1.5 text-xs font-black uppercase tracking-wider rounded-xl transition shadow-xs cursor-pointer border
                        ${linker.color === "pink" ? "bg-[#FE2C55] border-transparent hover:opacity-90 text-white" : ""}
                        ${linker.color === "cyan" ? "bg-[#25F4EE] border-transparent hover:opacity-90 text-black" : ""}
                        ${linker.color === "purple" ? "bg-[#a855f7] border-transparent hover:opacity-90 text-white" : ""}
                        ${linker.color === "gold" ? "bg-[#eab308] border-transparent hover:opacity-90 text-zinc-950" : ""}
                        ${linker.color === "green" ? "bg-[#22c55e] border-transparent hover:opacity-90 text-white" : ""}
                        ${linker.color === "blue" ? "bg-[#3b82f6] border-transparent hover:opacity-90 text-white" : ""}
                      `}
                    >
                      Equip Character
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

      </main>
    </div>
  );
};
