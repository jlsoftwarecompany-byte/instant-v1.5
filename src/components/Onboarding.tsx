import React, { useState, useEffect } from "react";
import { wsService } from "../lib/ws";
import { useTheme } from "./ThemeContext";
import { User, Check, RefreshCw, AlertCircle, Sparkles, Eye, EyeOff } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface OnboardingProps {
  onOnboardingComplete: (user: any) => void;
  isConnected: boolean;
}

export const Onboarding: React.FC<OnboardingProps> = ({ onOnboardingComplete, isConnected }) => {
  const { theme } = useTheme();
  
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  
  // Checking states
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameFeedback, setUsernameFeedback] = useState<{
    status: "idle" | "available" | "taken" | "error";
    message: string;
  }>({ status: "idle", message: "" });

  const [registerError, setRegisterError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Listen for username validation and registration success
    const handleWsMessage = (data: any) => {
      switch (data.type) {
        case "CHECK_USERNAME_RESPONSE":
          if (data.username === username.toLowerCase().trim()) {
            setIsCheckingUsername(false);
            if (data.available) {
              setUsernameFeedback({
                status: "available",
                message: `@${data.username} is available!`
              });
            } else {
              setUsernameFeedback({
                status: "taken",
                message: "@handle is already taken — try another"
              });
            }
          }
          break;

        case "AUTH_SUCCESS":
          setIsSubmitting(false);
          localStorage.setItem("instant-session-token", data.sessionToken);
          localStorage.setItem("instant-username", data.user.username);
          onOnboardingComplete(data.user);
          break;

        case "AUTH_FAILURE":
          setIsSubmitting(false);
          setRegisterError(data.reason);
          break;

        case "REGISTER_SUCCESS":
          setIsSubmitting(false);
          onOnboardingComplete(data.user);
          break;

        case "ERROR":
          setIsSubmitting(false);
          setIsCheckingUsername(false);
          setRegisterError(data.message);
          break;
      }
    };

    const cleanup = wsService.registerListener(handleWsMessage);
    return () => cleanup();
  }, [username, onOnboardingComplete]);


  // Handle realtime username checking as user types
  useEffect(() => {
    const trimmed = username.toLowerCase().trim();
    if (!trimmed) {
      setUsernameFeedback({ status: "idle", message: "" });
      return;
    }

    // Alphanumeric + underscores only
    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(trimmed)) {
      setUsernameFeedback({
        status: "error",
        message: "Only letters, numbers, and underscores are allowed."
      });
      return;
    }

    if (trimmed.length > 20) {
      setUsernameFeedback({
        status: "error",
        message: "Username must be 20 characters or fewer"
      });
      return;
    }

    // Trigger server check
    setUsernameFeedback({ status: "idle", message: "" });
    setIsCheckingUsername(true);
    
    const debounceTimer = setTimeout(() => {
      if (isConnected) {
        wsService.send({
          type: "CHECK_USERNAME",
          username: trimmed
        });
      } else {
        setIsCheckingUsername(false);
        setUsernameFeedback({
          status: "error",
          message: "Connecting to server..."
        });
      }
    }, 450);

    return () => clearTimeout(debounceTimer);
  }, [username, isConnected]);

  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (usernameFeedback.status === "available") {
      setStep(2);
      // Prefill display name suggestions based on username
      setNickname(username.charAt(0).toUpperCase() + username.slice(1));
    }
  };

  const handleStep2Submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedNick = nickname.trim();
    if (trimmedNick.length < 1 || trimmedNick.length > 30) {
      setRegisterError("Display name must be between 1 and 30 characters");
      return;
    }
    setRegisterError("");
    setStep(3);
  };

  const handleStep3Submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setRegisterError("Password must be at least 8 characters long");
      return;
    }

    setIsSubmitting(true);
    setRegisterError("");
    wsService.send({
      type: "AUTH_REGISTER",
      username: username.toLowerCase().trim(),
      nickname: nickname.trim(),
      password
    });
  };

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
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-pink-500/10 to-purple-500/10 text-pink-500 mb-6 border border-pink-500/20 shadow-md animate-bounce" style={{ animationDuration: "3s" }}>
            <Sparkles className="w-7 h-7 text-pink-500 pink-glow-text" />
          </div>
          
          <h1 className="text-4xl font-black tracking-tight mb-2 tiktok-gradient-text uppercase">
            Instant
          </h1>
          <p className="text-xs font-bold theme-text-muted mb-8 max-w-[280px] tracking-wider uppercase">
            ⚡ Real-time, self-expiring messaging.
          </p>
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.form
              key="step1"
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 15 }}
              transition={{ duration: 0.25 }}
              onSubmit={handleStep1Submit}
              className="space-y-6"
            >
              <div>
                <label className="block text-xs font-semibold theme-text-primary tracking-wider uppercase mb-2">
                  Choose your @username
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
                    className="w-full pl-10 pr-12 py-4 rounded-xl border theme-border bg-[var(--background)] font-sans text-base font-medium theme-text-primary focus:outline-none focus:ring-1 focus:ring-indigo-500 transition shadow-xs"
                  />
                  <div className="absolute right-4 flex items-center">
                    {isCheckingUsername && (
                      <RefreshCw className="w-5 h-5 text-indigo-500 animate-spin" />
                    )}
                    {!isCheckingUsername && usernameFeedback.status === "available" && (
                      <Check className="w-5 h-5 text-emerald-500" />
                    )}
                    {!isCheckingUsername && (usernameFeedback.status === "taken" || usernameFeedback.status === "error") && (
                      <AlertCircle className="w-5 h-5 text-rose-500" />
                    )}
                  </div>
                </div>

                {/* Inline validations feedback */}
                <div className="h-6 mt-2">
                  {usernameFeedback.status === "available" && (
                    <p className="text-xs font-medium text-emerald-500 flex items-center gap-1.5 leading-none animate-in fade-in duration-200">
                      <Check className="w-3.5 h-3.5" />
                      {usernameFeedback.message}
                    </p>
                  )}
                  {usernameFeedback.status === "taken" && (
                    <p className="text-xs font-medium text-rose-500 flex items-center gap-1.5 leading-none animate-in fade-in duration-200">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {usernameFeedback.message}
                    </p>
                  )}
                  {usernameFeedback.status === "error" && (
                    <p className="text-xs font-medium text-amber-500 flex items-center gap-1.5 leading-none animate-in fade-in duration-200">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {usernameFeedback.message}
                    </p>
                  )}
                </div>
              </div>

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
                disabled={usernameFeedback.status !== "available" || isCheckingUsername || !isConnected}
                className="w-full py-4 bg-gradient-to-r from-[#FE2C55] to-[#a855f7] hover:opacity-95 disabled:from-zinc-400/20 disabled:to-zinc-400/30 disabled:text-zinc-500/60 disabled:cursor-not-allowed text-white font-bold tracking-wider uppercase text-xs rounded-xl transition shadow-lg shadow-pink-500/5 cursor-pointer active:scale-98"
              >
                Continue
              </button>
            </motion.form>
          )}

          {step === 2 && (
            <motion.form
              key="step2"
              initial={{ opacity: 0, x: 15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -15 }}
              transition={{ duration: 0.25 }}
              onSubmit={handleStep2Submit}
              className="space-y-6"
            >
              <div>
                <label className="block text-xs font-semibold theme-text-primary tracking-wider uppercase mb-2">
                  Choose a display name
                </label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. John Doe"
                  maxLength={30}
                  autoFocus
                  required
                  className="w-full px-4 py-4 rounded-xl border theme-border bg-[var(--background)] font-sans text-base font-medium theme-text-primary focus:outline-none focus:ring-1 focus:ring-pink-500 transition shadow-xs"
                />
                
                <p className="text-xs text-zinc-400 font-sans mt-3">
                  You'll appear as: <span className="font-semibold theme-text-primary">@{username.toLowerCase()}</span> (<span className="font-semibold text-pink-500">{nickname || "your name"}</span>)
                </p>
              </div>

              {registerError && (
                <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3">
                  <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                  <p className="text-xs text-rose-500 font-medium">{registerError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="w-1/3 py-4 border theme-border bg-transparent text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-[#FE2C55] dark:hover:text-[#25F4EE] font-bold uppercase text-xs rounded-xl transition cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={!nickname.trim()}
                  className="w-2/3 py-4 bg-gradient-to-r from-[#FE2C55] to-[#a855f7] hover:opacity-95 disabled:from-zinc-300 disabled:to-zinc-400 disabled:text-zinc-400 text-white font-bold tracking-wider uppercase text-xs rounded-xl transition shadow-lg shadow-pink-500/5 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                >
                  Continue
                </button>
              </div>
            </motion.form>
          )}

          {step === 3 && (
            <motion.form
              key="step3"
              initial={{ opacity: 0, x: 15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -15 }}
              transition={{ duration: 0.25 }}
              onSubmit={handleStep3Submit}
              className="space-y-6"
            >
              <div>
                <label className="block text-xs font-semibold theme-text-primary tracking-wider uppercase mb-2">
                  Create a password
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={8}
                    autoFocus
                    className="w-full pl-4 pr-12 py-4 rounded-xl border theme-border bg-[var(--background)] font-sans text-base font-medium theme-text-primary focus:outline-none focus:ring-1 focus:ring-pink-500 transition shadow-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <p className="text-[10px] text-zinc-400 font-sans mt-2 uppercase tracking-wide">
                  Must be at least 8 characters.
                </p>
              </div>

              {registerError && (
                <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3">
                  <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                  <p className="text-xs text-rose-500 font-medium">{registerError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="w-1/3 py-4 border theme-border bg-transparent text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-[#FE2C55] dark:hover:text-[#25F4EE] font-bold uppercase text-xs rounded-xl transition cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || password.length < 8}
                  className="w-2/3 py-4 bg-gradient-to-r from-[#FE2C55] to-[#a855f7] hover:opacity-95 disabled:from-zinc-300 disabled:to-zinc-400 disabled:text-zinc-400 text-white font-bold tracking-wider uppercase text-xs rounded-xl transition shadow-lg shadow-pink-500/5 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                >
                  {isSubmitting ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    "Complete Setup"
                  )}
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
