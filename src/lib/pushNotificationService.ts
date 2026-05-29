interface PushNotificationPayload {
  type: "opener_received" | "opener_responded" | "message_received" | "conversation_revived";
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: {
    conversationId?: number;
    senderId?: string;
    senderNickname?: string;
  };
}

export const triggerPushNotification = async (
  username: string,
  payload: PushNotificationPayload
) => {
  try {
    await fetch("/api/send-push-notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        ...payload
      })
    });
  } catch (err) {
    console.error("Push notification failed:", err);
  }
};
