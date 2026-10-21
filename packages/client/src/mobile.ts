// Mobile support: touch detection, a "turn the phone" prompt and a best-effort
// attempt to lock landscape. Browsers only allow the lock after a gesture and,
// on Chrome, only in fullscreen, so the prompt is the part that always works.

const TOUCH_QUERY = '(pointer: coarse)';

const isTouchDevice = (): boolean =>
  window.matchMedia(TOUCH_QUERY).matches ||
  'ontouchstart' in window ||
  new URLSearchParams(location.search).get('mobile') === '1';

export function isMobile(): boolean {
  return document.body.classList.contains('mobile');
}

export function initMobile(): void {
  if (!isTouchDevice()) return;
  document.body.classList.add('mobile');

  // One attempt, after the first real gesture, to ask the browser for landscape.
  const tryLock = (): void => {
    const orientation = screen.orientation as
      | (ScreenOrientation & { lock?: (mode: string) => Promise<void> })
      | undefined;

    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    void orientation?.lock?.('landscape').catch(() => undefined);
  };

  document.addEventListener('pointerdown', tryLock, { once: true });
}
