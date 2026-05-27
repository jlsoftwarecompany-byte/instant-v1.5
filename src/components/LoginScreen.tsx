import React, { useState, useEffect } from "react";
import { useTheme } from "./ThemeContext";
import { wsService } from "../lib/ws";
import { LogIn, AlertCircle, RefreshCw, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { motion } from "motion/react";

interface LoginScreenProps {
  onLoginSuccess: (user: any, token: string) => void;
  onBackToWelcome: () => void;
  isConnected: boolean;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, onBackToWelcome, isConnected }) => {
  const { theme } = useTheme();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    const handleWsMessage = (data: any) => {
      if (data.type === "AUTH_SUCCESS") {
        setIsLoading(false);
        onLoginSuccess(data.user, data.sessionToken);
      } else if (data.type === "AUTH_FAILURE") {
        setIsLoading(false);
        setError(data.reason);

        // Check for rate limit
        if (data.reason.includes("Rate limited")) {
          const match = data.reason.match(/Try again in (\d+)s/);
          setSecondsLeft(match ? parseInt(match[1], 10) : 30);
        }
      }
    };

    const cleanup = wsService.registerListener(handleWsMessage);
    return () => cleanup();
  }, [onLoginSuccess]);

  // Handle countdown count decrement
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => {
      setSecondsLeft(prev => prev - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || secondsLeft > 0) return;

    setError("");
    setIsLoading(true);

    wsService.send({
      type: "AUTH_LOGIN",
      username: username.toLowerCase().trim(),
      password
    });
  };

  const isButtonDisabled = isLoading || !username.trim() || !password || secondsLeft > 0 || !isConnected;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 font-sans bg-[var(--background)]">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="w-full max-w-md p-8 rounded-3xl theme-card border relative overflow-hidden shadow-2xl"
      >
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#25F4EE] via-[#a855f7] to-[#FE2C55] shadow-[0_0_15px_#FE2C55]" />
        
        <button
          onClick={onBackToWelcome}
          className="p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-pink-500 absolute top-5 left-5 transition cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center text-center mt-4">
          <h1 className="text-3xl font-black tracking-tight mb-2 tiktok-gradient-text uppercase">
            Log In
          </h1>
          <p className="text-xs font-bold theme-text-muted mb-8 tracking-wider uppercase">
            Access secure ephemeral chat.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold theme-text-primary tracking-wider uppercase mb-2">
              Your @username
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-4 text-lg font-medium text-zinc-400 select-none">
                @
              </span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s+/g, ""))}
                placeholder="username"
                autoFocus
                required
                className="w-full pl-10 pr-4 py-4 rounded-xl border theme-border bg-[var(--background)] font-sans text-base font-medium theme-text-primary focus:outline-none focus:ring-1 focus:ring-indigo-500 transition shadow-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold theme-text-primary tracking-wider uppercase mb-2">
              Password
            </label>
            <div className="relative flex items-center">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full pl-4 pr-12 py-4 rounded-xl border theme-border bg-[var(--background)] font-sans text-base font-medium theme-text-primary focus:outline-none focus:ring-1 focus:ring-indigo-500 transition shadow-xs"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3 animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
              <p className="text-xs text-rose-500 font-medium leading-normal">{error}</p>
            </div>
          )}

          {!isConnected && (
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-3">
              <RefreshCw className="w-4 h-4 text-amber-500 animate-spin flex-shrink-0" />
              <p className="text-xs text-amber-600 font-medium">
                Connecting to server... Please wait.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={isButtonDisabled}
            className="w-full py-4 bg-gradient-to-r from-[#FE2C55] to-[#a855f7] hover:opacity-95 disabled:from-zinc-400/20 disabled:to-zinc-400/30 disabled:text-zinc-500/60 disabled:cursor-not-allowed text-white font-bold tracking-wider uppercase text-xs rounded-xl transition shadow-lg shadow-pink-500/5 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
          >
            {isLoading ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : secondsLeft > 0 ? (
              `Try again in ${secondsLeft}s`
            ) : (
              "Log In"
            )}
          </button>
        </form>

        <div className="text-center mt-6">
          <button
            onClick={onBackToWelcome}
            className="text-xs font-semibold text-pink-500 hover:underline cursor-pointer"
          >
            Don't have an account? Create one
          </button>
        </div>
      </motion.div>
    </div>
  );
};
