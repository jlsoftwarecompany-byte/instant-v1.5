self.addEventListener("push", (event) => {
  try {
    const data = event.data ? event.data.json() : {};
    const title = data.title || "Instant Notification";
    const options = {
      body: data.body || "You have a new action waiting in Instant.",
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: data.data || {}
    };

    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  } catch (err) {
    console.error("Failed to parse push notification package payload:", err);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Deep-link into specific conversation if target is present
  const urlToOpen = new URL(self.location.origin);
  if (event.notification.data && event.notification.data.conversationId) {
    urlToOpen.searchParams.set("chat", event.notification.data.conversationId);
  }
  
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen.href && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen.href);
      }
    })
  );
});
