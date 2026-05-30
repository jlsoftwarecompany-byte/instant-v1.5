import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register the service worker as early as possible (not only at login) so that
// users running an old/poisoned cache pick up the fixed SW immediately. When a
// new worker takes control, reload once so the open tab jumps to the latest
// build instead of staying on stale code.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });

    // If the page already has a controlling SW, a later controllerchange means
    // the worker was *replaced* (an update) -> reload to run the new build.
    // If there was no controller at load (fresh visit), the first change is the
    // initial claim, not an update, so we must not reload then.
    const hadController = !!navigator.serviceWorker.controller;
    let hasReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || hasReloaded) return;
      hasReloaded = true;
      window.location.reload();
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
