import { loadPresets, savePresets, loadSettings, saveSettings, createPreset } from './store.js';
import { Session, nextPhase } from './timer.js';
import { unlockAudio, cue } from './sound.js';

const $ = (selector) => document.querySelector(selector);

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" class="stroke" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></svg>';

// Keep in sync with the phase colours in app.css; used for the Android status bar.
const PHASE_COLORS = { ready: '#2f6fed', work: '#16a34a', rest: '#f59e0b', done: '#2a3140' };
const APP_COLOR = '#0f1115';

let presets = loadPresets();
const settings = loadSettings();
let editing = null;
let session = null;
let loop = 0;
let wakeLock = null;

/* ---------- Formatting ---------- */

function clock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function short(seconds) {
  return seconds < 60 ? `${seconds}s` : clock(seconds);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function summary(p) {
  const work = p.work.mode === 'tap' ? `${p.work.label} (tap)` : `${short(p.work.seconds)} ${p.work.label}`;
  const rest = p.rest.mode === 'off' ? 'no rest'
    : p.rest.mode === 'tap' ? `${p.rest.label} (tap)`
    : `${short(p.rest.seconds)} ${p.rest.label}`;
  const rounds = p.rounds ? plural(p.rounds, 'round') : 'until stopped';
  return [work, rest, rounds].join(' · ');
}

/* ---------- Navigation ----------
   Each screen gets a history entry so Android's back gesture works as expected. */

const themeMeta = document.querySelector('meta[name="theme-color"]');

// Colours the Android status bar and anything showing around the page (overscroll).
function setChromeColor(color) {
  themeMeta.content = color;
  document.body.style.backgroundColor = color;
}

function show(view) {
  for (const id of ['home', 'edit', 'run']) $(`#${id}`).hidden = id !== view;
  if (view !== 'run') setChromeColor(APP_COLOR);
  window.scrollTo(0, 0);
}

function navigate(view, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState']({ view }, '');
  show(view);
}

window.addEventListener('popstate', (event) => {
  if (session && !session.done) {
    // A stray back swipe mid-drill must not end the session.
    history.pushState({ view: 'run' }, '');
    toast('Hold the stop button to end');
    return;
  }
  endSession();
  const view = event.state?.view ?? 'home';
  show(view === 'run' ? 'home' : view);
});

/* ---------- Home ---------- */

function renderHome() {
  $('#preset-list').replaceChildren(...presets.map(presetItem));
}

function presetItem(p) {
  const li = document.createElement('li');
  li.className = 'preset';
  li.innerHTML = `
    <button type="button" class="preset-start">
      <span class="play-dot">${ICON_PLAY}</span>
      <span class="preset-text"><span class="preset-name"></span><span class="preset-summary"></span></span>
    </button>
    <button type="button" class="icon-btn preset-edit" aria-label="Edit">${ICON_EDIT}</button>`;
  li.querySelector('.preset-name').textContent = p.name;
  li.querySelector('.preset-summary').textContent = summary(p);
  li.querySelector('.preset-edit').setAttribute('aria-label', `Edit ${p.name}`);
  li.querySelector('.preset-start').addEventListener('click', () => {
    startSession(p);
    navigate('run');
  });
  li.querySelector('.preset-edit').addEventListener('click', () => openEditor(p));
  return li;
}

$('#new-btn').addEventListener('click', () => openEditor(null));

/* ---------- Steppers ----------
   − / + buttons (hold to repeat) around a text field that also accepts typed values
   like "90" or "1:30". */

const steppers = new Map();

function nextStep(kind, value, dir) {
  if (kind !== 'duration') return value + dir;
  // Fine steps for short drills, coarser ones for match play.
  const size = (v) => (v < 30 ? 5 : v < 120 ? 15 : 30);
  if (dir > 0) {
    const s = size(value);
    return Math.floor(value / s) * s + s;
  }
  const s = size(value - 1);
  return Math.ceil(value / s) * s - s;
}

function parseStep(kind, text, zero) {
  const t = text.trim();
  if (zero && t.toLowerCase() === zero.toLowerCase()) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = kind === 'duration' && t.match(/^(\d+):(\d{1,2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function setupStepper(el) {
  const input = el.querySelector('input');
  const { kind, zero } = el.dataset;
  const min = Number(el.dataset.min);
  const max = Number(el.dataset.max);
  let value = min;

  const set = (v) => {
    value = Math.min(max, Math.max(min, v));
    input.value = value === 0 && zero ? zero : kind === 'duration' ? clock(value) : String(value);
  };
  const step = (dir) => set(nextStep(kind, value, dir));
  steppers.set(input.name, { get: () => value, set });

  for (const btn of el.querySelectorAll('button')) {
    const dir = Number(btn.dataset.step);
    let delay = 0;
    let repeat = 0;
    const stop = () => {
      clearTimeout(delay);
      clearInterval(repeat);
    };
    btn.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      step(dir);
      delay = setTimeout(() => (repeat = setInterval(() => step(dir), 90)), 450);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(type, stop);
    // Keyboard activation (pointer presses are handled above).
    btn.addEventListener('click', (event) => event.detail === 0 && step(dir));
  }

  input.addEventListener('focus', () => input.select());
  input.addEventListener('change', () => set(parseStep(kind, input.value, zero) ?? value));
}

document.querySelectorAll('.stepper').forEach(setupStepper);

/* ---------- Editor ---------- */

const form = $('#edit-form');

function openEditor(preset) {
  editing = preset ? structuredClone(preset) : createPreset();
  $('#edit-title').textContent = preset ? 'Edit timer' : 'New timer';
  $('#delete-btn').hidden = !preset;
  const f = form.elements;
  f.name.value = editing.name;
  f.workLabel.value = editing.work.label;
  f.restLabel.value = editing.rest.label;
  f.workMode.value = editing.work.mode;
  f.restMode.value = editing.rest.mode;
  steppers.get('delay').set(editing.delay);
  steppers.get('workSeconds').set(editing.work.seconds);
  steppers.get('restSeconds').set(editing.rest.seconds);
  steppers.get('rounds').set(editing.rounds);
  syncEditor();
  navigate('edit');
}

// Shows or hides rows tagged data-when="<radio name> <value> [<value>…]".
function syncEditor() {
  for (const el of form.querySelectorAll('[data-when]')) {
    const [field, ...values] = el.dataset.when.split(' ');
    el.hidden = !values.includes(form.elements[field].value);
  }
}

function readEditor() {
  const f = form.elements;
  const value = (name) => steppers.get(name).get();
  return {
    ...editing,
    name: f.name.value.trim() || 'Untitled timer',
    delay: value('delay'),
    rounds: value('rounds'),
    work: { label: f.workLabel.value.trim() || 'Work', mode: f.workMode.value, seconds: value('workSeconds') },
    rest: { label: f.restLabel.value.trim() || 'Rest', mode: f.restMode.value, seconds: value('restSeconds') },
  };
}

function saveEditor() {
  const preset = readEditor();
  const i = presets.findIndex((p) => p.id === preset.id);
  if (i >= 0) presets[i] = preset;
  else presets.push(preset);
  savePresets(presets);
  renderHome();
  return preset;
}

form.addEventListener('change', syncEditor);
form.addEventListener('submit', (event) => event.preventDefault());
$('#edit-back').addEventListener('click', () => history.back());
$('#save-btn').addEventListener('click', () => {
  saveEditor();
  history.back();
});
$('#edit-start').addEventListener('click', () => {
  startSession(saveEditor());
  navigate('run', { replace: true });
});
$('#delete-btn').addEventListener('click', () => {
  if (!confirm(`Delete “${editing.name}”?`)) return;
  presets = presets.filter((p) => p.id !== editing.id);
  savePresets(presets);
  renderHome();
  history.back();
});

/* ---------- Settings ---------- */

const settingsDialog = $('#settings');

$('#settings-btn').addEventListener('click', () => {
  for (const [key, on] of Object.entries(settings)) {
    const input = settingsDialog.querySelector(`[name="${key}"]`);
    if (input) input.checked = on;
  }
  settingsDialog.showModal();
});

settingsDialog.addEventListener('change', (event) => {
  settings[event.target.name] = event.target.checked;
  saveSettings(settings);
});

$('#test-sound').addEventListener('click', () => {
  unlockAudio();
  cue('work', settings);
});

if (!navigator.vibrate) {
  settingsDialog.querySelector('[name="vibrate"]').disabled = true;
  $('#no-vibrate').hidden = false;
}

/* ---------- Running ---------- */

const run = $('#run');
const ui = {
  name: $('#run-name'),
  round: $('#run-round'),
  label: $('#run-label'),
  time: $('#run-time'),
  tap: $('#run-tap'),
  bar: $('#run-bar'),
  next: $('#run-next'),
  pause: $('#pause-btn'),
};
let shownTime = '';

function startSession(preset) {
  unlockAudio();
  endSession();
  session = new Session(preset, onSessionEvent);
  ui.name.textContent = preset.name;
  session.start(performance.now());
  syncPause();
  requestWakeLock();
  loop = setInterval(tick, 100);
  tick();
}

function endSession() {
  clearInterval(loop);
  loop = 0;
  session = null;
  releaseWakeLock();
}

function tick() {
  if (!session) return;
  const now = performance.now();
  session.update(now);
  renderTime(now);
}

function onSessionEvent(type) {
  if (type === 'count' && !settings.countdown) return;
  if (type === 'warning' && !settings.minuteWarning) return;
  if (type !== 'phase') {
    cue(type, settings);
    return;
  }
  const { kind } = session.phase;
  renderPhase();
  if (kind !== 'ready') cue(kind, settings);
  if (kind === 'done') finish();
}

function renderPhase() {
  const { preset, phase } = session;
  const timed = phase.duration != null;
  run.dataset.kind = phase.kind;
  setChromeColor(PHASE_COLORS[phase.kind]);
  ui.label.textContent = phase.kind === 'done' ? 'Done' : phase.label;
  ui.round.textContent = phase.kind === 'ready' || phase.kind === 'done' ? ''
    : preset.rounds ? `Round ${phase.round} / ${preset.rounds}`
    : `Round ${phase.round}`;
  ui.tap.hidden = timed || phase.kind === 'done';
  ui.time.classList.toggle('small', !timed);
  ui.bar.parentElement.hidden = !timed;
  ui.next.textContent = nextText(preset, phase);
  // Size the digits once per phase, for the widest time it will show, so they don't jump.
  sizeTime(timed ? timeText(phase, Math.ceil(phase.duration / 1000)) : '0:00');
  shownTime = '';
}

function nextText(preset, phase) {
  if (phase.kind === 'done') return '';
  const next = nextPhase(preset, phase);
  if (next.kind === 'done') return 'Last round';
  return `Next: ${next.label}${next.duration != null ? ` ${short(next.duration / 1000)}` : ''}`;
}

function renderTime(now) {
  const { phase } = session;
  if (phase.kind === 'done') return;
  if (phase.duration == null) {
    // Tap-to-proceed: count up so you can see how long the swap is taking.
    setTime(clock(Math.floor(session.elapsed(now) / 1000)));
    return;
  }
  const rem = session.remaining(now);
  setTime(timeText(phase, Math.ceil(rem / 1000)));
  ui.bar.style.transform = `scaleX(${1 - rem / phase.duration})`;
}

// Phases under a minute show plain seconds (bigger digits); longer ones keep m:ss all the
// way down, so the format never changes mid-phase.
function timeText(phase, sec) {
  return phase.duration < 60000 ? String(sec) : clock(sec);
}

function setTime(text) {
  if (text === shownTime) return;
  shownTime = text;
  ui.time.textContent = text;
}

// Approximate width of the text in em, so CSS can size the digits to fill the screen.
function sizeTime(text) {
  const colons = text.split(':').length - 1;
  ui.time.style.setProperty('--w', ((text.length - colons) * 0.66 + colons * 0.32).toFixed(2));
}

function finish() {
  clearInterval(loop);
  loop = 0;
  releaseWakeLock();
  const total = clock(Math.round(session.activeTime() / 1000));
  ui.time.classList.add('small');
  sizeTime(total);
  setTime(total);
  ui.next.textContent = `${plural(session.phase.round, 'round')} completed`;
}

function syncPause() {
  const { paused } = session;
  run.classList.toggle('paused', paused);
  ui.pause.innerHTML = paused ? ICON_PLAY : ICON_PAUSE;
  ui.pause.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
}

function stopSession() {
  endSession();
  history.back();
}

ui.pause.addEventListener('click', () => {
  if (!session || session.done) return;
  session.toggle(performance.now());
  syncPause();
  tick();
});

$('#next-btn').addEventListener('click', () => {
  session?.next(performance.now());
  tick();
});

$('#prev-btn').addEventListener('click', () => {
  session?.prev(performance.now());
  tick();
});

// The whole middle of the screen is the "continue" button during tap phases.
$('#run-main').addEventListener('click', () => {
  if (!session || session.done || session.phase.duration !== null || session.paused) return;
  session.proceed(performance.now());
  tick();
});

// Stop needs a 0.8 s hold so a bump or a kid grabbing the phone doesn't end the session.
const stopBtn = $('#stop-btn');
let holdTimer = 0;
const cancelHold = () => {
  clearTimeout(holdTimer);
  stopBtn.classList.remove('holding');
};
stopBtn.addEventListener('pointerdown', () => {
  stopBtn.classList.add('holding');
  holdTimer = setTimeout(() => {
    cancelHold();
    stopSession();
  }, 800);
});
for (const type of ['pointerup', 'pointerleave', 'pointercancel']) stopBtn.addEventListener(type, cancelHold);
stopBtn.addEventListener('click', (event) => event.detail === 0 && stopSession());

$('#again-btn').addEventListener('click', () => startSession(session.preset));
$('#home-btn').addEventListener('click', () => history.back());

// Long-press must not open the context menu or select text on the running screen.
run.addEventListener('contextmenu', (event) => event.preventDefault());
// Re-arm audio on every touch; iOS can suspend it after a phone call or notification.
run.addEventListener('pointerdown', unlockAudio);

// Keyboard shortcuts, handy when testing on a laptop.
document.addEventListener('keydown', (event) => {
  if (run.hidden || !session || event.target.closest('button, input')) return;
  const actions = {
    ' ': () => ui.pause.click(),
    ArrowRight: () => $('#next-btn').click(),
    ArrowLeft: () => $('#prev-btn').click(),
    Enter: () => $('#run-main').click(),
    Escape: () => session.done || stopSession(),
  };
  if (actions[event.key]) {
    event.preventDefault();
    actions[event.key]();
  }
});

/* ---------- Screen wake lock ---------- */

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// The browser drops the wake lock when the app is hidden; take it again on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session && !session.done) {
    requestWakeLock();
    tick();
  }
});

/* ---------- Toast ---------- */

let toastTimer = 0;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

/* ---------- Start ---------- */

history.replaceState({ view: 'home' }, '');
renderHome();
show('home');

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
