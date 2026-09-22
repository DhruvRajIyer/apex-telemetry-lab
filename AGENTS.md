# Project

APEX is a static Vite + TypeScript + Three.js lap explorer. The core view is a procedural 3D open-wheel car, not a flat car illustration. The user chose original F1 styling, real FastF1 data, 2026 Monaco qualifying's fastest overall lap, and a polished core experience. Ask before substituting another session or synthetic telemetry.

# Commands

- Frontend: `npm install`, `npm run dev` (localhost only), `npm run build`, `npm run preview`.
- Unit tests: `npm test` (Node 22.18+ recommended for native TypeScript stripping).
- Browser tests: `npx playwright install chromium`, then `npm run test:e2e`. Playwright starts Vite if necessary. Desktop/mobile screenshots are saved in ignored `test-results/`. The browser download stalled on this Mac; tests passed with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" npm run test:e2e`, which uses a fresh isolated test profile, not the user's browsing profile.
- Formatting: `npm run format`.
- Data extraction requires Python 3.10+ and `pip install -r requirements.txt`. FastF1 3.6.1 failed on the 2026 telemetry stream; 3.8.3 works.
- This workspace has an isolated Python 3.12 environment at `.venv-data`: `.venv-data/bin/python extract_lap.py 2026 Monaco public/lap.json`.
- Python model tests: `.venv-data/bin/python -m unittest test_extract_lap.py`.

# Data and rendering

- `public/catalog.json` and its 12 `public/laps/` assets provide real 2026 Monaco, Monza and Suzuka qualifying. The user chose four distinct teams per circuit. The four quickest teams are identified by official personal-best timing; each uses its fastest usable accurate non-pit, non-deleted lap. Selection notes disclose replacements. `public/lap.json` is a compatibility copy of the default Monaco Antonelli lap (72.051 seconds, 722 playback points).
- Rebuild the catalog with `.venv-data/bin/python extract_lap.py 2026 --catalog`; single-lap exports accept `--driver VER`. Runtime uses the catalog, not the compatibility copy. User explicitly approved substituting the fastest usable lap when source telemetry is unreliable. Suzuka uses Russell (89.076s) after three Antonelli attempts failed the unchanged-source-channel gate.
- The exporter rejects >=5 seconds of all five car channels unchanged within the lap and native source gaps >2 seconds. These are quality heuristics, not calibrated accuracy guarantees. Source throttle above 100% is bounded, with extrema and adjustment counts recorded in quality metadata. Never fill faulty data with synthetic measurements.
- `extract_lap.py` fetches/caches FastF1 and writes schema version 1, model version 2. Original asynchronous car/position channels align directly to a 10 Hz playback grid. Motion derivatives use a padded uniform grid. FastF1 positions are converted from decimetres to metres; distance is speed-integrated. Corner XY markers are projected onto the chosen lap before assigning distance, not copied from the session-fastest lap's speed integration.
- Brake heat uses interval kinetic-energy loss minus assumed drag, gated by the preceding brake state, then an exact constant-input exponential cooling step. Ambient uses available lap weather. The 800 kg mass and all aero/geometry/thermal parameters are generic, not actual 2026 team specifications; missing regen, active aero and initial thermal state remain explicit limitations. See README.md for formulas and review findings.
- `src/telemetry.ts` validates exports and interpolates continuous channels; brake, gear and DRS are held discretely.
- Wheel order is FL, FR, RL, RR. Positive lateral g denotes a left turn; right wheels gain load. Wheel-load estimates conserve total vertical force.
- Brake temperatures, g-forces, wheel loads and aero load are illustrative estimates, never measured data. Model constants are in the JSON and the in-app methodology dialog. No tyre temperatures or ERS estimates are claimed.
- The user wants intense, clearly visible heat changes, especially saturated red at the lap peak. `src/telemetry.ts` owns the shared lap-relative colour scale and peak summaries. All four wheels share a scale; do not normalise each wheel separately or inflate the physics values for visual effect. Heat overlays use unlit, non-tone-mapped materials so scene lighting cannot bleach the colours.
- The map and timeline follow the selected layer: hottest disc, heaviest wheel, downforce, or speed. Per-wheel gauges include full-lap maxima; the timeline also shows individual-wheel traces and measured brake-on bands. Peak controls seek to the actual exported sample time. Red denotes this lap's maximum, not a calibrated danger threshold.
- The UI intentionally does not interpret the legacy DRS channel as an active 2026 DRS system.
- Playback defaults to paused. Missing data must remain an explicit error, with no synthetic fallback. WebGL failure must leave map and telemetry usable.
- Production output is `dist/`; runtime is static and does not need Python. No hosting provider has been selected, and no deployment has been performed.
- The frontend remains vanilla TypeScript. `src/motion.ts` imports the JavaScript API from `motion` (not `motion/dom` or React), handles interruptible decorative animations, and cancels them when reduced motion is enabled. Keep measured/estimated readouts, heat colours and seek cursors immediate; never animate numerical values between drivers.
- The persistent transport and timeline share playback state. A ResizeObserver reserves space for the dock, including mobile safe areas. Pointer inspection must not change playback time. Preserve native dialog focus restoration and driver-card focus when the selection UI is rebuilt.
