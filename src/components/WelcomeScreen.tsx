import React from "react";
import { useTheme } from "./ThemeContext";
import { Sparkles, LogIn, UserPlus } from "lucide-react";
import { motion } from "motion/react";

interface WelcomeScreenProps {
  onCreateAccount: () => void;
  onLogIn: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onCreateAccount, onLogIn }) => {
  const { theme } = useTheme();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 font-sans bg-[var(--background)]">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="w-full max-w-md p-8 rounded-3xl theme-card border relative overflow-hidden shadow-2xl"
      >
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#25F4EE] via-[#a855f7] to-[#FE2C55] shadow-[0_0_15px_#FE2C55]" />
        
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-pink-500/10 to-purple-500/10 text-pink-500 mb-6 border border-pink-500/20 shadow-md animate-bounce" style={{ animationDuration: "3.5s" }}>
            <Sparkles className="w-8 h-8 text-pink-500 pink-glow-text" />
          </div>
          
          <h1 className="text-4xl font-black tracking-tight mb-2 tiktok-gradient-text uppercase">
            Instant
          </h1>
          <p className="text-xs font-bold theme-text-muted mb-8 max-w-[280px] tracking-wider uppercase">
            ⚡ Real-time, self-expiring messaging.
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={onCreateAccount}
            className="w-full py-4 bg-gradient-to-r from-[#FE2C55] to-[#a855f7] hover:opacity-95 text-white font-bold tracking-wider uppercase text-xs rounded-xl transition shadow-lg shadow-pink-500/5 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
          >
            <UserPlus className="w-4 h-4" />
            Create Account
          </button>

          <button
            onClick={onLogIn}
            className="w-full py-4 border theme-border bg-transparent text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-[#FE2C55] dark:hover:text-[#25F4EE] font-bold tracking-wider uppercase text-xs rounded-xl transition flex items-center justify-center gap-2 cursor-pointer active:scale-98"
          >
            <LogIn className="w-4 h-4" />
            Log In
          </button>
        </div>
      </motion.div>
    </div>
  );
};
