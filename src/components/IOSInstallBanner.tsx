import { useState, useEffect } from 'react';

export function IOSInstallBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = localStorage.getItem('ios-install-dismissed');

    if (isIOS && !isStandalone && !dismissed) {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 shadow-xl flex items-start gap-3">
      <div className="flex-1 text-sm theme-text-primary">
        <p className="font-bold mb-1">Install Instant</p>
        <p className="text-[var(--muted-text)]">
          Tap <strong>Share</strong> then <strong>"Add to Home Screen"</strong> for the full app experience.
        </p>
      </div>
      <button
        onClick={() => {
          localStorage.setItem('ios-install-dismissed', '1');
          setShow(false);
        }}
        className="text-[var(--muted-text)] text-xl leading-none"
      >
        ×
      </button>
    </div>
  );
}
