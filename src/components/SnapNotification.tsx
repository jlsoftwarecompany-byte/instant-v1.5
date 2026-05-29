import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  MessageCircle,
  Zap,
  Heart,
  Gift,
  Archive,
  X,
  Flame
} from 'lucide-react';

export interface SnapNotificationItem {
  id: string;
  type: "message_in_other_chat" | "conversation_exploded" | "links_earned" | "friend_added" | "conversation_revived";
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  accentColor: string;
  textColor: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface SnapNotificationQueueProps {
  notifications: SnapNotificationItem[];
  onDismiss: (id: string) => void;
}

export const SnapNotificationQueue: React.FC<SnapNotificationQueueProps> = ({
  notifications,
  onDismiss
}) => {
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] pointer-events-none">
      <AnimatePresence>
        {notifications.map((notif, idx) => (
          <SnapNotificationItemComponent
            key={notif.id}
            notification={notif}
            index={idx}
            onDismiss={() => onDismiss(notif.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

interface SnapNotificationItemComponentProps {
  notification: SnapNotificationItem;
  index: number;
  onDismiss: () => void;
}

const SnapNotificationItemComponent: React.FC<SnapNotificationItemComponentProps> = ({
  notification,
  index,
  onDismiss
}) => {
  const [isDismissing, setIsDismissing] = useState(false);

  useEffect(() => {
    const duration = notification.duration || 4500;
    const timer = setTimeout(() => {
      setIsDismissing(true);
      setTimeout(onDismiss, 300);
    }, duration);

    return () => clearTimeout(timer);
  }, [notification.id, onDismiss, notification.duration]);

  const yOffset = index * 90;

  return (
    <motion.div
      initial={{ y: -120, opacity: 0 }}
      animate={{ y: yOffset, opacity: 1 }}
      exit={{ y: -120, opacity: 0, transition: { duration: 0.3 } }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="absolute left-1/2 -translate-x-1/2 top-4 pointer-events-auto"
    >
      <div
        className={`
          mx-4 px-4 py-3 rounded-2xl border shadow-2xl backdrop-blur-lg
          flex items-center gap-3 min-w-[280px] max-w-[380px]
          bg-white/95 dark:bg-zinc-900/95
          border-zinc-200/50 dark:border-zinc-700/50
          ${notification.accentColor}
        `}
      >
        {/* Icon */}
        <div className={`flex-shrink-0 text-xl ${notification.textColor}`}>
          {notification.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className={`text-sm font-black tracking-tight ${notification.textColor} truncate`}>
            {notification.title}
          </h3>
          {notification.subtitle && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400 truncate mt-0.5">
              {notification.subtitle}
            </p>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={() => {
            setIsDismissing(true);
            setTimeout(onDismiss, 300);
          }}
          className="flex-shrink-0 p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Optional action button */}
        {notification.action && (
          <button
            onClick={notification.action.onClick}
            className={`flex-shrink-0 px-2.5 py-1 text-[9px] font-black rounded-lg transition
              ${notification.accentColor} ${notification.textColor} hover:opacity-80
            `}
          >
            {notification.action.label}
          </button>
        )}

        {/* Progress bar */}
        <motion.div
          initial={{ width: "100%" }}
          animate={{ width: "0%" }}
          transition={{ duration: (notification.duration || 4500) / 1000, ease: "linear" }}
          className={`absolute bottom-0 left-0 h-0.5 ${notification.accentColor}`}
        />
      </div>
    </motion.div>
  );
};
