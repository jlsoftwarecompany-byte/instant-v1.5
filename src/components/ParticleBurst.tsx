import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Award, Sparkles } from "lucide-react";

interface ParticleBurstProps {
  amount?: number;
  reason?: string;
  onComplete: () => void;
  mode?: "award" | "explosion";
}

export const ParticleBurst: React.FC<ParticleBurstProps> = ({ amount, reason, onComplete, mode = "award" }) => {
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; size: number; delay: number; color: string }[]>([]);

  useEffect(() => {
    // Generate particles streaming outward
    const count = mode === "explosion" ? 24 : 32;
    const colors = ["#FE2C55", "#ea580c", "#f97316", "#ef4444", "#facc15"];
    
    const p = Array.from({ length: count }).map((_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const velocity = mode === "explosion" 
        ? 40 + Math.random() * 110 // smaller, denser explosion for bubble
        : 80 + Math.random() * 180;
      
      const particleColor = mode === "explosion"
        ? colors[Math.floor(Math.random() * colors.length)]
        : "#fbbf24";

      return {
        id: i,
        x: Math.cos(angle) * velocity,
        y: Math.sin(angle) * velocity,
        size: mode === "explosion" 
          ? 3 + Math.random() * 6 // slightly smaller glowing embers
          : 4 + Math.random() * 8,
        delay: Math.random() * 0.15,
        color: particleColor,
      };
    });
    setParticles(p);

    const duration = mode === "explosion" ? 800 : 2800;
    const t = setTimeout(() => {
      onComplete();
    }, duration);

    return () => clearTimeout(t);
  }, [onComplete, mode]);

  if (mode === "explosion") {
    return (
      <div className="absolute inset-0 pointer-events-none z-30 flex items-center justify-center">
        <div className="relative w-1 h-1">
          {/* Explosion Amber/Flame Particles */}
          {particles.map(p => (
            <motion.div
              key={p.id}
              initial={{ x: 0, y: 0, opacity: 1, scale: 0.8 }}
              animate={{
                x: p.x,
                y: p.y,
                opacity: 0,
                scale: 0.1,
              }}
              transition={{
                duration: 0.65,
                delay: p.delay,
                ease: "easeOut",
              }}
              className="absolute rounded-full"
              style={{
                width: p.size,
                height: p.size,
                backgroundColor: p.color,
                boxShadow: `0 0 8px ${p.color}`,
                left: -p.size / 2,
                top: -p.size / 2,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
      <div className="relative flex flex-col items-center justify-center p-8 text-center bg-zinc-950 border border-amber-500/30 rounded-2xl shadow-2xl max-w-xs animate-in fade-in zoom-in duration-300">
        <div className="relative">
          {/* Particles */}
          {particles.map(p => (
            <motion.div
              key={p.id}
              initial={{ x: 0, y: 0, opacity: 1, scale: 0.5 }}
              animate={{
                x: p.x,
                y: p.y,
                opacity: 0,
                scale: 1.5,
              }}
              transition={{
                duration: 1.5,
                delay: p.delay,
                ease: "easeOut",
              }}
              className="absolute w-3 h-3 rounded-full"
              style={{
                width: p.size,
                height: p.size,
                backgroundColor: p.color,
                boxShadow: "0 0 10px #fbbf24",
              }}
            />
          ))}

          {/* Centered Award */}
          <motion.div
            initial={{ scale: 0.3, rotate: -30 }}
            animate={{ scale: [1.2, 1], rotate: 0 }}
            transition={{ type: "spring", duration: 0.8 }}
            className="w-20 h-20 bg-gradient-to-br from-amber-300 to-yellow-500 rounded-full flex items-center justify-center shadow-lg shadow-yellow-500/20"
          >
            <Award className="w-10 h-10 text-zinc-950" />
          </motion.div>
        </div>

        {/* Heading */}
        <motion.h2
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-2xl font-bold font-sans text-amber-400 mt-5 flex items-center gap-1.5 justify-center"
        >
          <Sparkles className="w-5 h-5 text-amber-400 animate-pulse" />
          Link Earned!
        </motion.h2>

        {/* Description */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="text-zinc-300 font-sans text-sm mt-2"
        >
          +{amount} {amount === 1 ? "link" : "links"}
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ delay: 0.7 }}
          className="text-zinc-400 text-xs mt-1 italic"
        >
          {reason}
        </motion.p>
      </div>
    </div>
  );
};
