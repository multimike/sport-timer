# Sport Timer

An interval timer PWA for coaching (built for kids' badminton): work/rest intervals, a start
delay, a fixed number of rounds or "until stopped", and phases that wait for a tap (e.g. swap
partners). Plain HTML/CSS/JS, no build step, works offline once loaded.

## Run locally

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080. On a laptop: Space = pause, ←/→ = back/skip,
Enter = continue a tap phase, Esc = stop.

Opening it on your phone over your local network (`http://192.168.…`) is fine for checking the
layout, but service workers and the screen wake lock only run on HTTPS, so test those on a
deployed copy.

## Deploy

Live at **https://timer.ikanos.se**, served by GitHub Pages from the `main` branch (root
folder). Pushing to `main` deploys.

- The `CNAME` file holds the custom domain; GitHub reads it.
- DNS: `timer.ikanos.se` has a `CNAME` record pointing to `multimike.github.io`.
- All paths are relative, so the app also works under `https://multimike.github.io/sport-timer/`.

To host another app on a subdomain: give it its own repo with a `CNAME` file containing the
new name (e.g. `scores.ikanos.se`), enable Pages, and add a matching DNS `CNAME` record.

## Install on a phone

- **Android (Chrome):** open the site, then use ⋮ → *Add to home screen* / *Install app*.
- **iPhone (Safari):** open the site, then Share → *Add to Home Screen*.

## Things to know on court

- **Keep the app open with the screen on.** The app holds a screen wake lock while a session
  runs. Phones pause web apps when you lock them or switch away, so cues stop until you come back.
  (The timer stays correct and catches up when you return.)
- **iPhone:** sounds play even with the silent switch on (iOS 17+), but web apps can't vibrate on
  iOS. This audio mode may also pause music playing from the same phone.
- **Stop needs a hold** (0.8 s). A stray back gesture won't end a session either.
- Timers are saved on the device only (localStorage).

## Files

| Path | What |
| --- | --- |
| `index.html` | All screens: home, editor, running timer, settings |
| `css/app.css` | Styles; phase colours are at the top |
| `js/app.js` | UI, navigation, wake lock |
| `js/timer.js` | Timer engine (phase sequence, drift-free timing, cues) |
| `js/sound.js` | Synthesised beeps/whistles and vibration patterns |
| `js/store.js` | Presets, defaults and settings in localStorage |
| `sw.js` | Service worker for offline use |
| `tools/make-icons.py` | Regenerates the PNG icons in `icons/` |

When you add a file, also add it to `ASSETS` in `sw.js` so it works offline.
