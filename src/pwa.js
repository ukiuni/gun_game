// PWA: service-worker registration + "install app" button (Android/Chrome) / hint (iOS Safari).
let deferredPrompt = null;

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches || window.navigator.standalone === true;
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!window.isSecureContext) return Promise.resolve(null);
  return navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => {
    console.warn('service worker registration failed', e);
    return null;
  });
}

/** onChange(state): state = 'prompt' (install button usable) | 'ios' (show Add-to-Home hint) | 'hidden' */
export function setupInstall(onChange) {
  const update = () => {
    if (isStandalone()) onChange('hidden');
    else if (deferredPrompt) onChange('prompt');
    else if (isIos()) onChange('ios');
    else onChange('hidden');
  };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    update();
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; update(); });
  update();
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
  return choice?.outcome === 'accepted';
}
