// Per-browser preferences (last setup, sound, text speed). Storage can be
// unavailable (private windows, blocked site data), so every access is guarded
// and the app works without it.

const PREFIX = 'pixel-parley:';

export function loadPref(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function savePref(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // ignore: preferences are a convenience
  }
}
