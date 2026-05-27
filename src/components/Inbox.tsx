import React, { useState } from "react";
import { User, Friendship, Conversation } from "../types";
import { wsService } from "../lib/ws";
import { 
  Plus, Settings, User as UserIcon, LogOut, Star, MessageSquarePlus, 
  Send, UserX, UserCheck, AlertCircle, Sparkles, MessageCircle, ArrowRight,
  Clock
} from "lucide-react";
import { useTheme } from "./ThemeContext";
import { motion, AnimatePresence } from "motion/react";

interface InboxProps {
  currentUser: User;
  friendshipsList: Friendship[];
  allUsersMap: Record<string, { nickname: string; links: number; linker_avatar?: string; linker_color?: string }>;
  activeConversations: Conversation[];
  timersList: any[];
  discoverUsers: { username: string; nickname: string; links: number; linker_avatar?: string; linker_color?: string }[];
  onOpenChat: (contact: { username: string; nickname: string; links: number; linker_avatar?: string; linker_color?: string }, conversationId: number) => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  onOpenGenerator: () => void;
  onLogOut: () => void;
}

export const Inbox: React.FC<InboxProps> = ({
  currentUser,
  friendshipsList,
  allUsersMap,
  activeConversations,
  timersList,
  discoverUsers = [],
  onOpenChat,
  onOpenSettings,
  onOpenProfile,
  onOpenGenerator,
  onLogOut
}) => {
  const { theme } = useTheme();

  // Add friend states
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);
  const [addFriendInput, setAddFriendInput] = useState("");
  const [addFriendFeedback, setAddFriendFeedback] = useState<{
    status: "idle" | "success" | "error";
    message: string;
  }>({ status: "idle", message: "" });
  const [isSubmittingFriend, setIsSubmittingFriend] = useState(false);

  // Manage incoming Vs outgoing friendships
  const incomingPending = friendshipsList.filter(
    f => f.receiver_username.toLowerCase() === currentUser.username && f.status === "pending"
  );
  
  const outgoingPending = friendshipsList.filter(
    f => f.requester_username.toLowerCase() === currentUser.username && f.status === "pending"
  );

  // Accepted friends (either requester or receiver)
  const acceptedFriendships = friendshipsList.filter(f => f.status === "accepted");

  // Get friends models list
  const friendsList = acceptedFriendships.map(f => {
    const friendUsername = f.requester_username.toLowerCase() === currentUser.username
      ? f.receiver_username.toLowerCase()
      : f.requester_username.toLowerCase();
    
    const uInfo = allUsersMap[friendUsername] || { nickname: friendUsername, links: 0, linker_avatar: '👾', linker_color: 'pink' };
    return {
      username: friendUsername,
      nickname: uInfo.nickname,
      links: uInfo.links,
      linker_avatar: uInfo.linker_avatar || '👾',
      linker_color: uInfo.linker_color || 'pink'
    };
  });

  const sendFriendRequest = (e: React.FormEvent) => {
    e.preventDefault();
    const handle = addFriendInput.toLowerCase().trim().replace(/^@/, "");

    if (!handle) return;
    if (handle === currentUser.username) {
      setAddFriendFeedback({ status: "error", message: "You cannot add yourself" });
      return;
    }

    setIsSubmittingFriend(true);
    setAddFriendFeedback({ status: "idle", message: "" });

    // Setup direct notification feedback listener
    const handleAddFriendResponse = (data: any) => {
      if (data.type === "FRIEND_REQUEST_RESPONSE") {
        setIsSubmittingFriend(false);
        if (data.success) {
          setAddFriendFeedback({
            status: "success",
            message: `Friend request sent to @${handle}!`
          });
          setAddFriendInput("");
        } else {
          setAddFriendFeedback({
            status: "error",
            message: data.error || "Failed to send request"
          });
        }
        // Remove temporary response listener
        cleanup();
      }
    };

    const cleanup = wsService.registerListener(handleAddFriendResponse);

    // Send payload
    wsService.send({
      type: "FRIEND_REQUEST",
      receiverUsername: handle
    });
  };

  const handleAcceptFriend = (requesterUsername: string) => {
    wsService.send({
      type: "FRIEND_ACCEPT",
      requesterUsername: requesterUsername.toLowerCase()
    });
  };

  const handleDeclineFriend = (requesterUsername: string) => {
    wsService.send({
      type: "FRIEND_DECLINE",
      requesterUsername: requesterUsername.toLowerCase()
    });
  };

  // Get active timers count or timer indicator for conversations
  const getConversationTimerText = (conversationId: number) => {
    const t = timersList.find(timer => timer.conversation_id === conversationId);
    if (!t) return null;
    return "active timer";
  };

  // Find respective conversation ID for friend
  const findConversationId = (friendUsername: string) => {
    const conv = activeConversations.find(
      c => (c.participant_1.toLowerCase() === currentUser.username && c.participant_2.toLowerCase() === friendUsername) ||
           (c.participant_2.toLowerCase() === currentUser.username && c.participant_1.toLowerCase() === friendUsername)
    );
    return conv ? conv.id : null;
  };

  return (
    <div className="flex flex-col min-h-screen bg-[var(--background)] font-sans">
      
      {/* Top Header navbar with quick controls */}
      <header className="px-6 py-5 border-b theme-border bg-[var(--background)] sticky top-0 z-40 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          {/* Avatar Click launches Profile representation screen */}
          <button
            onClick={onOpenProfile}
            className={`w-11 h-11 rounded-2xl flex items-center justify-center text-2xl cursor-pointer shadow-md transition-all active:scale-95 border select-none
              ${(currentUser.linker_color || 'pink') === 'pink' ? 'bg-[#FE2C55]/10 border-[#FE2C55]/30' : ''}
              ${(currentUser.linker_color || 'pink') === 'cyan' ? 'bg-[#25F4EE]/10 border-[#25F4EE]/30' : ''}
              ${(currentUser.linker_color || 'pink') === 'purple' ? 'bg-[#a855f7]/10 border-[#a855f7]/30' : ''}
              ${(currentUser.linker_color || 'pink') === 'gold' ? 'bg-[#eab308]/10 border-[#eab308]/30' : ''}
              ${(currentUser.linker_color || 'pink') === 'green' ? 'bg-[#22c55e]/10 border-[#22c55e]/30' : ''}
              ${(currentUser.linker_color || 'pink') === 'blue' ? 'bg-[#3b82f6]/10 border-[#3b82f6]/30' : ''}
            `}
          >
            {currentUser.linker_avatar || "👾"}
          </button>
          
          <div>
            <h1 onClick={onOpenProfile} className="text-sm font-black theme-text-primary flex items-center gap-1 cursor-pointer hover:text-pink-500 transition-colors uppercase leading-none">
              {currentUser.nickname}
            </h1>
            <p className="text-[10px] text-zinc-400 font-bold mt-1 uppercase tracking-wider flex items-center gap-1">
              SCORE: <span className="text-amber-500 font-black flex items-center gap-0.5">⭐ {currentUser.links} LINKS</span>
            </p>
          </div>
        </div>

        {/* Global actions bar */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowAddFriendModal(true)}
            className="p-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-xl text-zinc-500 hover:text-indigo-600 transition"
            title="Add Friend"
          >
            <MessageSquarePlus className="w-5 h-5" />
          </button>
          <button
            onClick={onOpenSettings}
            className="p-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-xl text-zinc-500 hover:text-indigo-600 transition"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button
            onClick={onLogOut}
            className="p-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-xl text-zinc-500 hover:text-rose-600 transition"
            title="Log Out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Container contents */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-8 space-y-8">
        
        {/* Banner highlight about instant */}
        <section className="p-4 bg-gradient-to-tr from-[#FE2C55]/10 via-[#a855f7]/5 to-transparent border border-[#FE2C55]/10 rounded-2xl flex items-center gap-3 shadow-md">
          <div className="p-2.5 bg-gradient-to-tr from-[#FE2C55] to-[#a855f7] rounded-xl text-white shrink-0 shadow-lg shadow-pink-500/10">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="font-extrabold text-xs tracking-wider text-pink-500 uppercase flex items-center gap-1.5">
              Interactive Messaging <span className="text-[10px] lowercase text-purple-400 font-normal">neon edition</span>
            </h3>
            <p className="text-xs theme-text-muted font-medium">Earn score links by opening conversations and replying before timers expire.</p>
          </div>
        </section>

        {/* Incoming/Outgoing requests notifications list */}
        {incomingPending.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-xs font-bold tracking-widest text-zinc-400 uppercase">
              Pending Invites ({incomingPending.length})
            </h2>
            <div className="space-y-2.5">
              {incomingPending.map(req => {
                const reqUser = req.requester_username.toLowerCase();
                const detail = allUsersMap[reqUser] || { nickname: reqUser, links: 0 };
                return (
                  <motion.div 
                    key={req.id} 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-pink-500/20 dark:border-purple-500/30 flex items-center justify-between shadow-xs"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-gradient-to-tr from-[#FE2C55] to-[#a855f7] rounded-xl flex items-center justify-center font-bold text-sm text-white uppercase shadow-sm">
                        {detail.nickname.slice(0, 2)}
                      </div>
                      <div>
                        <h4 className="font-bold text-sm theme-text-primary">
                          {detail.nickname}
                        </h4>
                        <p className="text-xs text-zinc-400">
                          @{req.requester_username}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleAcceptFriend(req.requester_username)}
                        className="p-2.5 bg-gradient-to-r from-[#FE2C55] to-[#a855f7] hover:opacity-95 text-white rounded-xl transition text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        <UserCheck className="w-4 h-4" /> Accept
                      </button>
                      <button
                        onClick={() => handleDeclineFriend(req.requester_username)}
                        className="p-2.5 border theme-border hover:bg-rose-500/10 hover:border-rose-500/20 text-zinc-400 hover:text-rose-500 rounded-xl transition text-xs font-bold cursor-pointer"
                      >
                        <UserX className="w-4 h-4" /> Dismiss
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </section>
        )}

        {/* Make Friends / Discover Linkers Section */}
        {discoverUsers.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-black tracking-widest text-zinc-400 uppercase flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#FE2C55] animate-pulse" /> Make Friends (Already on App)
              </h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {discoverUsers.map((user) => {
                const uAvatar = user.linker_avatar || "👾";
                const uColor = user.linker_color || "pink";
                
                return (
                  <motion.div
                    key={user.username}
                    whileHover={{ scale: 1.02 }}
                    className={`p-4 rounded-3xl theme-card border relative overflow-hidden flex flex-col justify-between h-36 transition-all duration-200 bg-[var(--card-bg)]
                      ${uColor === 'pink' ? 'border-[#FE2C55]/20 bg-gradient-to-tr from-[#FE2C55]/5 to-transparent shadow-[0_0_8px_rgba(254,44,85,0.05)]' : ''}
                      ${uColor === 'cyan' ? 'border-[#25F4EE]/20 bg-gradient-to-tr from-[#25F4EE]/5 to-transparent shadow-[0_0_8px_rgba(37,244,238,0.05)]' : ''}
                      ${uColor === 'purple' ? 'border-[#a855f7]/20 bg-gradient-to-tr from-[#a855f7]/5 to-transparent shadow-[0_0_8px_rgba(168,85,247,0.05)]' : ''}
                      ${uColor === 'gold' ? 'border-[#eab308]/20 bg-gradient-to-tr from-[#eab308]/5 to-transparent shadow-[0_0_8px_rgba(234,179,8,0.05)]' : ''}
                      ${uColor === 'green' ? 'border-[#22c55e]/20 bg-gradient-to-tr from-[#22c55e]/5 to-transparent shadow-[0_0_8px_rgba(34,197,94,0.05)]' : ''}
                      ${uColor === 'blue' ? 'border-[#3b82f6]/20 bg-gradient-to-tr from-[#3b82f6]/5 to-transparent shadow-[0_0_8px_rgba(59,130,246,0.05)]' : ''}
                    `}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xl shrink-0 select-none border
                        ${uColor === 'pink' ? 'bg-[#FE2C55]/10 border-[#FE2C55]/20' : ''}
                        ${uColor === 'cyan' ? 'bg-[#25F4EE]/10 border-[#25F4EE]/20' : ''}
                        ${uColor === 'purple' ? 'bg-[#a855f7]/10 border-[#a855f7]/20' : ''}
                        ${uColor === 'gold' ? 'bg-[#eab308]/10 border-[#eab308]/20' : ''}
                        ${uColor === 'green' ? 'bg-[#22c55e]/10 border-[#22c55e]/20' : ''}
                        ${uColor === 'blue' ? 'bg-[#3b82f6]/10 border-[#3b82f6]/20' : ''}
                      `}>
                        {uAvatar}
                      </div>

                      <div className="min-w-0 flex-1">
                        <h4 className="font-extrabold text-[11px] theme-text-primary uppercase truncate tracking-tight leading-none">
                          {user.nickname}
                        </h4>
                        <p className="text-[9px] text-zinc-400 font-bold truncate mt-1">
                          @{user.username}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-1 mt-2.5">
                      <div className="flex items-center gap-0.5 text-[9px] text-zinc-400 font-black">
                        <Star className="w-3 w-3 fill-amber-500 text-amber-500 shrink-0" />
                        <span className="text-zinc-500 dark:text-zinc-300">{user.links}</span>
                      </div>

                      <button
                        onClick={() => {
                          wsService.send({
                            type: "FRIEND_REQUEST",
                            receiverUsername: user.username
                          });
                        }}
                        className={`px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded-lg transition duration-150 cursor-pointer border
                          ${uColor === 'pink' ? 'bg-[#FE2C55] border-[#FE2C55] text-white hover:opacity-90' : ''}
                          ${uColor === 'cyan' ? 'bg-[#25F4EE] border-[#25F4EE] text-black hover:opacity-90' : ''}
                          ${uColor === 'purple' ? 'bg-[#a855f7] border-[#a855f7] text-white hover:opacity-90' : ''}
                          ${uColor === 'gold' ? 'bg-[#eab308] border-[#eab308] text-zinc-950 hover:opacity-90' : ''}
                          ${uColor === 'green' ? 'bg-[#22c55e] border-[#22c55e] text-white hover:opacity-90' : ''}
                          ${uColor === 'blue' ? 'bg-[#3b82f6] border-[#3b82f6] text-white hover:opacity-90' : ''}
                        `}
                      >
                        ⚡ Add
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </section>
        )}

        {/* Active Conversations list section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold tracking-widest text-zinc-400 uppercase">
              Active Conversations ({friendsList.length})
            </h2>
            <button
              onClick={() => setShowAddFriendModal(true)}
              className="text-xs font-black text-pink-500 flex items-center gap-1 hover:underline decoration-pink-500/40 cursor-pointer active:scale-95 transition-transform"
            >
              <Plus className="w-3.5 h-3.5 text-[#FE2C55]" /> Start Chat
            </button>
          </div>

          <div className="rounded-3xl theme-card border divide-y theme-border overflow-hidden bg-[var(--card-bg)]">
            {friendsList.length === 0 ? (
              <div className="p-10 text-center flex flex-col items-center justify-center space-y-3">
                <div className="p-3 bg-zinc-100 dark:bg-zinc-950/70 rounded-full text-zinc-400">
                  <MessageCircle className="w-6 h-6 text-pink-500" />
                </div>
                <div>
                  <h4 className="font-bold text-sm theme-text-primary">Connect to Chat</h4>
                  <p className="text-xs text-zinc-400 mt-1 max-w-[210px] mx-auto leading-relaxed">
                    Click "Start Chat" or add a permanent `@username` to launch a new ephemeral messaging timeline.
                  </p>
                </div>
              </div>
            ) : (
              <AnimatePresence>
                {friendsList.map((friend, idx) => {
                  const convId = findConversationId(friend.username);
                  const hasTimer = convId ? getConversationTimerText(convId) : null;
                  const conversation = activeConversations.find(c => c.id === convId);
                  const isSaved = conversation?.saved === 1;

                  return (
                    <motion.div
                      key={friend.username}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ type: "spring", stiffness: 450, damping: 28, delay: idx * 0.05 }}
                      whileHover={{ scale: 1.01, x: 2, backgroundColor: theme === "black" ? "#140e2b" : "#fbf8ff" }}
                      whileTap={{ scale: 0.995 }}
                      onClick={() => convId && onOpenChat(friend, convId)}
                      className="p-5 flex items-center justify-between cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-2xl border shrink-0 select-none
                          ${(friend.linker_color || 'pink') === 'pink' ? 'bg-[#FE2C55]/10 border-[#FE2C55]/30 shadow-md' : ''}
                          ${(friend.linker_color || 'pink') === 'cyan' ? 'bg-[#25F4EE]/10 border-[#25F4EE]/30 shadow-md' : ''}
                          ${(friend.linker_color || 'pink') === 'purple' ? 'bg-[#a855f7]/10 border-[#a855f7]/30 shadow-md' : ''}
                          ${(friend.linker_color || 'pink') === 'gold' ? 'bg-[#eab308]/10 border-[#eab308]/30 shadow-md' : ''}
                          ${(friend.linker_color || 'pink') === 'green' ? 'bg-[#22c55e]/10 border-[#22c55e]/30 shadow-md' : ''}
                          ${(friend.linker_color || 'pink') === 'blue' ? 'bg-[#3b82f6]/10 border-[#3b82f6]/30 shadow-md' : ''}
                        `}>
                          {friend.linker_avatar || "👾"}
                        </div>

                        <div className="text-left">
                          <h3 className="font-extrabold text-sm theme-text-primary flex items-center gap-1.5 leading-none uppercase">
                            {friend.nickname}
                            {isSaved && (
                              <span className="text-[8px] px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-sm font-black tracking-wide uppercase">
                                Saved
                              </span>
                            )}
                          </h3>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-xs text-zinc-400">@{friend.username}</span>
                            <span className="text-[10px] font-black text-amber-500 bg-amber-500/10 px-1.5 py-0.2 rounded">
                              ⭐ {friend.links}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {hasTimer && !isSaved && (
                          <span className="px-2 py-0.5 text-[9px] font-black text-rose-500 bg-rose-500/5 border border-rose-500/15 rounded-md tracking-wider uppercase flex items-center gap-1 animate-pulse">
                            <Clock className="w-2.5 h-2.5 shrink-0" />
                            EXPIRY RUNNING
                          </span>
                        )}
                        <ArrowRight className="w-4 h-4 text-zinc-300" />
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        </section>

      </main>

      {/* Add Friend Popup Modal layout */}
      {showAddFriendModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <form 
            onSubmit={sendFriendRequest}
            className="w-full max-w-md p-6 bg-[var(--background)] border theme-border rounded-3xl shadow-2xl relative space-y-5 animate-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black theme-text-primary flex items-center gap-1.5">
                <MessageSquarePlus className="w-5 h-5 text-indigo-500" /> Start Chat
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowAddFriendModal(false);
                  setAddFriendFeedback({ status: "idle", message: "" });
                  setAddFriendInput("");
                }}
                className="text-xs text-zinc-400 hover:theme-text-primary font-bold transition px-2 py-1 bg-zinc-50 dark:bg-zinc-900 border theme-border rounded-lg"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed font-sans">
              Type the permanent `@username` of the companion you would like to connect with. They must already be registered.
            </p>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold theme-text-primary uppercase">
                Recipient Handle
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-4 font-bold text-zinc-400 select-none">@</span>
                <input
                  type="text"
                  value={addFriendInput}
                  onChange={(e) => setAddFriendInput(e.target.value.replace(/\s+/g, ""))}
                  placeholder="username"
                  required
                  autoFocus
                  className="w-full pl-8 pr-4 py-3 border theme-border bg-[var(--background)] rounded-xl font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm transition"
                />
              </div>
            </div>

            {/* In-app feedback responses */}
            <div className="h-6">
              {addFriendFeedback.status === "success" && (
                <p className="text-xs text-emerald-500 font-medium flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4" />
                  {addFriendFeedback.message}
                </p>
              )}
              {addFriendFeedback.status === "error" && (
                <p className="text-xs text-rose-500 font-medium flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" />
                  {addFriendFeedback.message}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmittingFriend || !addFriendInput.trim()}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-400/20 disabled:text-zinc-500/50 text-white font-bold tracking-wide rounded-xl transition shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5"
            >
              <Send className="w-4 h-4" /> Send Request
            </button>
          </form>
        </div>
      )}

    </div>
  );
};
