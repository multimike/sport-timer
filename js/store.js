// Presets and settings, kept in localStorage on the device.

const PRESETS_KEY = 'sport-timer:presets';
const SETTINGS_KEY = 'sport-timer:settings';

const DEFAULT_SETTINGS = { sound: true, vibrate: true, countdown: true, minuteWarning: true };

// mode: 'timed' | 'tap' (rest also 'off'); rounds 0 = until stopped.
const DEFAULT_PRESETS = [
  {
    id: 'drills',
    name: 'Drills 20/15',
    delay: 10,
    rounds: 8,
    work: { label: 'Work', mode: 'timed', seconds: 20 },
    rest: { label: 'Rest', mode: 'timed', seconds: 15 },
  },
  {
    id: 'match',
    name: 'Match play',
    delay: 10,
    rounds: 0,
    work: { label: 'Play', mode: 'timed', seconds: 300 },
    rest: { label: 'Swap partners', mode: 'tap', seconds: 30 },
  },
];

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or disabled (private mode): the app still works, it just won't remember.
  }
}

export function loadPresets() {
  return read(PRESETS_KEY, null) ?? structuredClone(DEFAULT_PRESETS);
}

export function savePresets(presets) {
  write(PRESETS_KEY, presets);
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY, {}) };
}

export function saveSettings(settings) {
  write(SETTINGS_KEY, settings);
}

export function createPreset() {
  return {
    id: crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2),
    name: 'New timer',
    delay: 10,
    rounds: 8,
    work: { label: 'Work', mode: 'timed', seconds: 30 },
    rest: { label: 'Rest', mode: 'timed', seconds: 15 },
  };
}
