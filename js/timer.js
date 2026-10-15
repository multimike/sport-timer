// Timer engine. A session walks through phases:
//   ready → work 1 → rest 1 → work 2 → … → work N → done
// rounds = 0 means "until stopped". A phase with duration null waits for a tap.
// All times are performance.now() milliseconds; the UI calls update() on a timer.

export function hasRest(preset) {
  return preset.rest.mode === 'tap' || (preset.rest.mode === 'timed' && preset.rest.seconds > 0);
}

function phase(preset, kind, round) {
  if (kind === 'done') return { kind, round };
  const spec = kind === 'ready'
    ? { label: 'Get ready', mode: 'timed', seconds: preset.delay }
    : preset[kind];
  return {
    kind,
    round,
    label: spec.label,
    duration: spec.mode === 'tap' ? null : spec.seconds * 1000,
  };
}

export function firstPhase(preset) {
  return preset.delay > 0 ? phase(preset, 'ready', 1) : phase(preset, 'work', 1);
}

export function nextPhase(preset, cur) {
  switch (cur.kind) {
    case 'ready':
      return phase(preset, 'work', 1);
    case 'work':
      if (preset.rounds && cur.round >= preset.rounds) return phase(preset, 'done', cur.round);
      return hasRest(preset) ? phase(preset, 'rest', cur.round) : phase(preset, 'work', cur.round + 1);
    case 'rest':
      return phase(preset, 'work', cur.round + 1);
    default:
      return cur;
  }
}

export function prevPhase(preset, cur) {
  switch (cur.kind) {
    case 'work':
      if (cur.round > 1) {
        return hasRest(preset) ? phase(preset, 'rest', cur.round - 1) : phase(preset, 'work', cur.round - 1);
      }
      return preset.delay > 0 ? phase(preset, 'ready', 1) : cur;
    case 'rest':
      return phase(preset, 'work', cur.round);
    default:
      return cur;
  }
}

// Events passed to emit(type, data):
//   'phase'   a new phase started (including 'done')
//   'count'   3, 2, 1 seconds left of a timed phase
//   'warning' 1 minute left of a phase that is 2 minutes or longer
export class Session {
  constructor(preset, emit) {
    this.preset = preset;
    this.emit = emit;
    this.paused = false;
    this.pausedTotal = 0;
  }

  get done() {
    return this.phase?.kind === 'done';
  }

  start(now) {
    this.startedAt = now;
    this.go(firstPhase(this.preset), now);
  }

  elapsed(now) {
    return (this.paused ? this.pausedAt : now) - this.phaseStart;
  }

  remaining(now) {
    return this.phase.duration == null ? null : Math.max(0, this.phase.duration - this.elapsed(now));
  }

  activeTime(now) {
    return (this.endedAt ?? (this.paused ? this.pausedAt : now)) - this.startedAt - this.pausedTotal;
  }

  update(now) {
    if (this.paused || this.done) return;
    const { duration } = this.phase;
    if (duration != null && now - this.phaseStart >= duration) {
      // Advance on the planned schedule rather than when this tick happened to run, so
      // nothing drifts. After a long gap (screen was off) several phases may have ended;
      // skip through them silently and only announce the one we land in.
      let at = this.phaseStart + duration;
      let next = nextPhase(this.preset, this.phase);
      while (next.duration != null && now - at >= next.duration) {
        at += next.duration;
        next = nextPhase(this.preset, next);
      }
      this.go(next, at);
      return;
    }
    this.countdown(now);
  }

  countdown(now) {
    const rem = this.remaining(now);
    if (rem == null) return;
    const sec = Math.ceil(rem / 1000);
    if (sec === this.lastSecond) return;
    this.lastSecond = sec;
    if (sec >= 1 && sec <= 3 && this.phase.duration >= 4000) this.emit('count', sec);
    if (sec === 60 && this.phase.duration >= 120000) this.emit('warning');
  }

  toggle(now) {
    if (this.done) return;
    if (this.paused) {
      const gap = now - this.pausedAt;
      this.phaseStart += gap;
      this.pausedTotal += gap;
      this.paused = false;
    } else {
      this.paused = true;
      this.pausedAt = now;
    }
  }

  next(now) {
    if (!this.done) this.go(nextPhase(this.preset, this.phase), now);
  }

  // Like a music player: restart the phase, or go back one if it only just started.
  prev(now) {
    if (this.done) return;
    this.go(this.elapsed(now) > 2000 ? this.phase : prevPhase(this.preset, this.phase), now);
  }

  // Ends a tap-to-proceed phase.
  proceed(now) {
    if (this.phase.duration === null && !this.paused) this.next(now);
  }

  go(phase, at) {
    if (this.paused) {
      // Skipping while paused: stay paused at the start of the new phase.
      this.pausedTotal += at - this.pausedAt;
      this.pausedAt = at;
    }
    this.phase = phase;
    this.phaseStart = at;
    this.lastSecond = phase.duration == null ? null : Math.ceil(phase.duration / 1000);
    if (phase.kind === 'done') {
      this.endedAt = at;
      this.paused = false;
    }
    this.emit('phase', phase);
  }
}
