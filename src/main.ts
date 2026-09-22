import "./style.css";
import { CarView, type Layer } from "./car";
import { reveal, setupMotion, stopMotion } from "./motion";
import {
  clamp,
  formatTime,
  sampleAt,
  validateLap,
  validateCatalog,
  type Catalog,
  type CatalogCircuit,
  type CatalogDriver,
  summarizeLayer,
  layerValue,
  heatIntensity,
  heatColorHex,
  HEAT_STOPS,
  type LayerSummary,
  type Lap,
  type Sample,
} from "./telemetry";

const icon = (name: string, size = 20) => {
  const paths: Record<string, string> = {
    play: '<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
    reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
    back: '<path d="m13 7-6 5 6 5M18 7v10"/>',
    next: '<path d="m11 7 6 5-6 5M6 7v10"/>',
    brake:
      '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v2m0 12v2M4 12h2m12 0h2"/>',
    tyre: '<rect x="7" y="3" width="10" height="18" rx="4"/><path d="m8 6 8 4m-8 0 8 4m-8 0 8 4"/>',
    aero: '<path d="M3 7h12c6 0 6-5 2-5M3 12h16M3 17h12c6 0 6 5 2 5"/>',
    clean: '<path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5"/>',
    arrow: '<path d="M5 19 19 5M5 5h14v14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    orbit:
      '<ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="2"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.info}</svg>`;
};

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <a class="skip-link" href="#workspace">Skip to telemetry</a>
  <header class="header">
    <a class="brand" href="./" aria-label="APEX Telemetry Lab home"><span class="brand-mark">A</span><span>APEX<small>TELEMETRY LAB</small></span></a>
    <section class="session-picker" aria-label="Choose session"><label>Circuit<select id="circuit-select" aria-label="Circuit" disabled></select></label><label>Driver<select id="driver-select" aria-label="Driver" disabled></select></label></section>
    <span class="archive-badge"><i class="status-dot"></i> FASTF1 ARCHIVE</span>
    <button class="text-button" id="methodology">Model notes ${icon("info", 16)}</button>
  </header>
  <main>
    <section class="session-bar" aria-label="Session details">
      <div class="session-title"><span id="circuit-flag" class="flag-monaco" aria-hidden="true"></span><div><span class="eyebrow" id="session-year">2026 WORLD CHAMPIONSHIP</span><h1><span id="circuit-name">—</span> <span>Qualifying</span></h1></div></div>
      <div class="session-item session-kind"><span class="eyebrow">LAP SELECTION</span><strong>Usable team best</strong></div>
      <div class="session-item driver-item"><span class="eyebrow">DRIVER</span><strong id="driver-name">Loading session…</strong><span class="team-line"><i id="team-swatch"></i><span id="team" class="muted"></span></span></div>
      <div class="session-item lap-item"><span class="eyebrow">LAP TIME</span><strong id="lap-time" class="mono">—:——.———</strong></div>
      <div class="session-item tyre-item"><span class="eyebrow">COMPOUND</span><strong><i class="compound-dot" id="compound-dot"></i><span id="compound">—</span></strong><span class="muted" id="tyre-age">—</span></div>
    </section>
    <div class="driver-grid" id="driver-grid" role="group" aria-label="Team representatives"></div>
    <div class="collection-meta"><p id="circuit-character">Loading the real lap collection…</p><span>04 TEAMS <b>/</b> 01 SELECTED LAP</span></div>
    <div id="selection-notes" class="selection-notes" hidden></div>
    <div class="data-status-row"><div id="data-status" class="data-status" role="status">Loading the FastF1 archive…</div><button id="retry-load" class="rate-button" hidden>Retry data load</button></div>
    <section class="workspace" id="workspace" tabindex="-1" aria-label="Interactive telemetry workspace" aria-busy="true">
      <aside class="layers-panel">
        <div class="panel-heading"><h2 class="eyebrow">01 / VISUALISATION</h2><span class="panel-index">4 LAYERS</span></div>
        <div class="layer-buttons" role="group" aria-label="Heat visualisation layer">
          <button class="layer-button active" data-layer="brakes" aria-pressed="true"><span class="layer-icon">${icon("brake")}</span><span><strong>Brake heat</strong><small>Energy into temperature</small></span><span class="radio"></span></button>
          <button class="layer-button" data-layer="loads" aria-pressed="false"><span class="layer-icon">${icon("tyre")}</span><span><strong>Wheel loads</strong><small>Every corner, every contact</small></span><span class="radio"></span></button>
          <button class="layer-button" data-layer="aero" aria-pressed="false"><span class="layer-icon">${icon("aero")}</span><span><strong>Aero load</strong><small>The weight of the air</small></span><span class="radio"></span></button>
          <button class="layer-button" data-layer="clean" aria-pressed="false"><span class="layer-icon">${icon("clean")}</span><span><strong>Pure machine</strong><small>No overlays. Just the car.</small></span><span class="radio"></span></button>
        </div>
        <div class="stage-measure"><span class="eyebrow" id="measure-label">HOTTEST DISC TEMPERATURE</span><div><strong id="measure-value">—</strong><span id="measure-unit">°C</span><span class="estimate-pill">EST.</span></div><div class="intensity-meter"><i id="intensity-fill"></i></div><span id="intensity-state">LAP-RELATIVE HEAT</span></div>
        <div class="heat-legend" id="heat-legend"><div><span id="legend-low">—</span><span id="legend-high">—</span></div><div class="heat-gradient"></div><small id="legend-caption">LAP MIN → LAP PEAK · RELATIVE SCALE</small></div>
        <button class="peak-panel" id="jump-peak" aria-describedby="peak-note" disabled aria-label="Jump to selected layer peak"><span>LAP PEAK <strong id="peak-value">—</strong></span><span><span id="peak-time">—</span><span>Seek ${icon("arrow", 12)}</span></span></button>
        <span id="peak-note" class="peak-note" hidden>Peak is the assumed starting temperature, not a measured braking event.</span>
        <details class="layer-explainer"><summary><span id="layer-title">Brake temperature</span></summary><span class="model-badge" id="layer-badge">PHYSICS ESTIMATE</span><p id="layer-description">Braking energy warms the discs. Airflow cools them between corners.</p><button class="inline-link" id="model-link">Method & assumptions ${icon("arrow", 12)}</button></details>
        <div class="source-note"><span class="status-dot"></span><div><strong>Real inputs. Modelled forces.</strong><small>FastF1 telemetry + illustrative physics</small></div></div>
      </aside>
      <section class="car-stage" aria-label="3D car visualisation">
        <div class="stage-watermark" id="stage-watermark" aria-hidden="true">APEX</div>
        <div class="stage-top"><h2 class="eyebrow">02 / VEHICLE VIEW</h2><span class="view-label">PROCEDURAL 3D</span></div>
        <div class="camera-controls" role="group" aria-label="Camera view"><button class="active" data-camera="orbit" aria-pressed="true">${icon("orbit", 15)} Orbit</button><button data-camera="top" aria-pressed="false">Top</button><button data-camera="side" aria-pressed="false">Side</button><button id="reset-view" aria-label="Reset camera view" title="Reset camera view">${icon("reset", 14)}</button></div>
        <div id="car-canvas"></div>
        <div class="wheel-readouts" id="wheel-readouts">${["FL", "FR", "RL", "RR"].map((label) => `<div id="wheel-card-${label}"><span>${label}</span><strong id="wheel-${label}">—</strong><small class="wheel-unit">°C</small><div class="wheel-meter"><i id="wheel-fill-${label}"></i></div><small class="wheel-peak" id="wheel-peak-${label}">LAP MAX —</small></div>`).join("")}</div>
        <div class="stage-bottom"><span class="orbit-hint">${icon("orbit", 16)} Drag to orbit · Scroll to zoom</span><span class="view-label">TEAM-INSPIRED CHASSIS</span></div>
      </section>
      <aside class="telemetry-panel">
        <section class="track-panel"><div class="panel-heading"><span class="eyebrow">03 / CIRCUIT POSITION</span><span id="sector-badge" class="sector-badge">S1</span></div><div class="track-title"><h2 id="track-title">—</h2><span id="turn-count">—</span></div><div class="track-wrap"><canvas id="track" role="img" aria-label="Track map coloured by speed with current car position"></canvas><span class="track-start">START / FINISH</span></div><div class="track-caption"><span id="track-distance">— m</span><span><i></i> <span id="track-channel">Brake heat · est.</span></span></div></section>
        <section class="inputs-panel"><div class="panel-heading"><span class="eyebrow">DRIVER INPUTS</span><span class="measured-tag">MEASURED</span></div><div class="speed-row"><div><span class="eyebrow">SPEED</span><div class="speed-value"><strong id="speed">—</strong><span>km/h</span></div></div><div class="gear-display"><strong id="gear">—</strong><span>GEAR</span></div></div><div class="input-channel"><div><span>Throttle</span><strong id="throttle">—</strong></div><div class="bar-track"><div id="throttle-bar" class="bar-fill throttle-fill"></div></div></div><div class="input-channel"><div><span>Brake <small>on / off</small></span><strong id="brake">—</strong></div><div class="bar-track"><div id="brake-bar" class="bar-fill brake-fill"></div></div></div><div class="rpm-row"><span>ENGINE</span><strong><span id="rpm">—</span> <small>RPM</small></strong></div><div class="g-readout"><span>G-FORCE <small>EST.</small></span><div><strong id="lat-g">—</strong><small>LATERAL</small></div><div><strong id="long-g">—</strong><small>LONG.</small></div></div></section>
      </aside>
    </section>
    <section class="timeline-panel" aria-label="Lap playback">
      <div class="timeline-heading"><h2 class="eyebrow">04 / LAP ANALYSIS</h2><div class="trace-key"><i></i><strong id="trace-channel">HOTTEST DISC · EST.</strong><span id="trace-unit">°C</span></div><span class="scrub-hint">Hover to inspect · Drag to seek</span></div>
      <div class="trace-container"><div class="trace-scale"><span>—</span><span>—</span><span>—</span></div><div class="trace-plot"><canvas id="trace" role="img" aria-label="Selected channel over the complete qualifying lap"></canvas><div class="trace-cursor" id="trace-cursor"><span id="cursor-time">0:00.000</span></div><div id="trace-inspection" class="trace-inspection" hidden><span>INSPECT <b id="inspect-time"></b></span><strong id="inspect-value"></strong></div><input id="scrubber" type="range" min="0" max="1" step="0.001" value="0" aria-label="Lap position in seconds" aria-describedby="trace-readout" disabled /></div></div>
      <div class="time-axis" id="time-axis" aria-label="Elapsed time in seconds"><span>0s</span><span>—</span><span>—</span><span>—</span><span>—</span></div>
      <p id="trace-readout" class="sr-only">Awaiting telemetry.</p>
      <div class="trace-annotations"><span><i class="braking-key"></i> BRAKE ON · MEASURED</span><span id="wheel-trace-key">FAINT LINES = INDIVIDUAL WHEELS</span><span><i class="peak-key"></i> LAP PEAK</span></div>
      <div class="corner-row"><label>Jump to corner<select id="corner-select" aria-label="Jump to corner" disabled><option value="">Select corner…</option></select></label><small>Approximate marker positions projected onto the selected lap.</small></div>
      <div class="sector-strip" id="sector-strip"><span>SECTOR 1</span><span>SECTOR 2</span><span>SECTOR 3</span></div>
    </section>
    <div class="lap-context"><div class="context-heading"><span>Real inputs. Illustrative physics.</span><span class="weather-line">AIR <strong id="air-temp">—</strong> <b>/</b> TRACK <strong id="track-temp">—</strong></span></div><p class="collection-note">Fastest usable lap from each of four teams. Lap-relative colours are not comparable across laps.</p><details><summary>Source quality & model limits</summary><p id="context-model">Uncalibrated physics estimates, not measured team performance.</p><p id="context-sampling">Awaiting telemetry.</p><p id="data-quality">—</p><p>All teams and circuits use the same generic mass, aero and thermal parameters. Read “Model notes” for the assumptions.</p></details></div>
    <section id="transport" class="transport" aria-label="Playback controls">
      <div class="playback-row"><div class="playback-controls"><button class="play-button" id="play" aria-label="Play lap" disabled>${icon("play", 22)}</button><button class="icon-button" id="skip-back" aria-label="Back five seconds" title="Back 5 seconds" disabled>${icon("back", 18)}</button><button class="icon-button" id="skip-next" aria-label="Forward five seconds" title="Forward 5 seconds" disabled>${icon("next", 18)}</button></div><span class="playback-clock"><strong id="current-time">0:00.000</strong><span>/</span><span id="duration">—:——.———</span></span><label class="dock-seek"><span class="sr-only">Playback position in seconds</span><input id="dock-scrubber" type="range" min="0" max="1" step="0.001" value="0" disabled /></label><button class="rate-button" id="rate" aria-label="Playback speed: 1 times" disabled>1×</button><div class="playback-state"><span id="playback-state">AWAITING TELEMETRY</span><span class="keyboard-hint"><kbd>SPACE</kbd> play / pause</span></div></div>
    </section>
  </main>
  <footer><span><strong>APEX</strong> A closer look at the limit.</span><span>Independent project. Not affiliated with Formula 1 or its teams.</span><button class="inline-link" id="footer-method">Data & model notes ${icon("info", 13)}</button></footer>
  <dialog id="model-dialog" aria-label="Data and physics model notes"><div class="dialog-header"><span class="eyebrow">TRANSPARENCY / NOT TEAM TELEMETRY</span><button class="icon-button" id="close-dialog" aria-label="Close model notes">${icon("close")}</button></div><h2>Real data.<br>Honest estimates.</h2><p>This is an exploration of a lap, not an engineering simulation. The stylised car is not a reconstruction of the driver's chassis.</p><div class="method-section"><h3>Measured, via FastF1</h3><p>Speed, throttle, brake on/off, gear, RPM, position, lap and sector times, and compound. Samples are aligned to a 10 Hz playback grid from asynchronous source channels; this does not increase the source resolution. Brake is not pedal pressure.</p></div><div class="method-section"><h3>Estimated, by the model</h3><p>Original car and position channels align directly to a padded uniform grid. Smoothed XY curvature × speed² estimates lateral g, capped at ±6 g; smoothed speed derivatives estimate longitudinal g, limited to −60…30 m/s². Smoothing suppresses noise and genuine short peaks. Wheel loads use a generic 800 kg mass, 3.4 m wheelbase, 1.6 m track and 0.3 m centre-of-gravity height. Weight and aero load use 46% front distribution; lateral load transfer splits equally between axles. Loads remain nonnegative and conserve total vertical force. These are not actual 2026 team specifications.</p><p>Brake heat uses each interval’s kinetic-energy loss after assumed aerodynamic drag, gated by the preceding brake sample. A stable exponential cooling step uses lap air temperature where available. The assumptions are 60% front bias, 350°C initial rotors, 2,000 J/K per rotor and 90% heat absorption. Regenerative braking, engine braking, grade and wind are omitted: residual deceleration is not measured friction-brake power. Left/right temperatures are identical by construction. Absolute temperatures are not calibrated.</p><p>Aero load follows ½ρC<sub>L</sub>Av² with C<sub>L</sub>A = 3.5 m² and ρ = 1.225 kg/m³. All circuits and teams use the same generic scenario, with no actual setup, active aero, banking or suspension dynamics. The coloured regions show relative total load, not a measured pressure distribution. Steering animation is illustrative, not steering telemetry. No tyre temperatures, fuel, suspension loads or ERS state are claimed.</p></div><div class="method-section"><h3>Reading the visual layers</h3><p>Colours use the full minimum-to-maximum range of the selected quantity in this lap: blue is the lap minimum, red is the lap peak. All four wheels share one scale, so front/rear differences remain comparable. Red does not imply a measured danger threshold, and colours should not be compared across different laps.</p><p>Brake rings and ground halos are visual overlays, not literal glowing tyres. Aero arrows show estimated downward force, not airflow. The map and main trace follow the hottest disc, heaviest wheel, total downforce, or speed, depending on the selected layer. Faint traces show individual wheels; the red strip records brake on/off. Peak readouts are calculated from the full pre-baked lap, not a new sensor recording. Temperature and force values are unchanged.</p></div><div class="method-section"><h3>Model constants</h3><dl class="constants"><div><dt>Mass</dt><dd>800 kg</dd></div><div><dt>Aero C<sub>L</sub>A</dt><dd>3.5 m²</dd></div><div><dt>Wheelbase / track</dt><dd>3.4 / 1.6 m</dd></div><div><dt>Centre of gravity</dt><dd>0.30 m</dd></div><div><dt>Initial discs</dt><dd>350°C</dd></div><div><dt>Rotor heat capacity</dt><dd>2,000 J/K per disc</dd></div></dl><p>Full assumptions are included in the lap JSON. They are illustrative and are not calibrated to the 2026 car regulations.</p></div><div class="dialog-source" id="dialog-source">Loading session provenance…</div><a class="download-link" href="${import.meta.env.BASE_URL}lap.json" download="monaco-fastest-lap.json">Download lap data ${icon("arrow", 14)}</a></dialog>
`;

const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const text = (id: string, value: string | number) => {
  el(id).textContent = String(value);
};
const disposeMotion = setupMotion();
reveal(document.querySelector(".header"));
const scrubber = el<HTMLInputElement>("scrubber");
const dockScrubber = el<HTMLInputElement>("dock-scrubber");
const transportObserver = new ResizeObserver(() => {
  document.documentElement.style.setProperty(
    "--dock-height",
    `${el("transport").getBoundingClientRect().height}px`,
  );
});
transportObserver.observe(el("transport"));
const playButton = el<HTMLButtonElement>("play");
const dialog = el<HTMLDialogElement>("model-dialog");
const status = el("data-status");
let lap: Lap | null = null;
let car: CarView | null = null;
let time = 0;
let playing = false;
let rate = 1;
let layer: Layer = "brakes";
let frame = 0;
let lastFrame = performance.now();
let lastUi = 0;
let sample: Sample | null = null;
let lastReadoutSample: Sample | null = null;
let summaries: Record<Layer, LayerSummary> | null = null;
let catalog: Catalog | null = null;
let selectedCircuit: CatalogCircuit | null = null;
let selectedDriver: CatalogDriver | null = null;
let loadVersion = 0;
let loadController: AbortController | null = null;
const channelNames: Record<Layer, string> = {
  brakes: "Hottest disc",
  loads: "Heaviest wheel",
  aero: "Downforce",
  clean: "Speed",
};
const displayValue = (value: number, selected: Layer = layer) =>
  selected === "loads" || selected === "aero"
    ? (value / 1000).toFixed(1)
    : value.toFixed(selected === "brakes" ? 1 : 0);
const channelColor = (s: Sample) =>
  heatColorHex(
    summaries ? heatIntensity(layerValue(s, layer), summaries[layer]) : 0,
  );

try {
  car = new CarView(el("car-canvas"));
} catch (error) {
  el("car-canvas").innerHTML =
    '<div class="webgl-error"><h3>3D needs WebGL.</h3><p>Enable hardware acceleration or try another browser. The lap map and telemetry remain available.</p></div>';
  console.error("3D renderer could not initialise", error);
}

const layerInfo: Record<
  Layer,
  {
    title: string;
    description: string;
    label: string;
    unit: string;
    low: string;
    high: string;
    caption: string;
  }
> = {
  brakes: {
    title: "Brake temperature model",
    description:
      "Braking energy warms the discs. Airflow cools them between corners. Watch the heat build and fade.",
    label: "HOTTEST DISC TEMPERATURE",
    unit: "°C",
    low: "150°C",
    high: "600°C",
    caption: "COOL → HOT · ESTIMATED",
  },
  loads: {
    title: "Wheel load model",
    description:
      "Braking shifts load forwards. Cornering shifts it sideways. The outside tyres carry the bigger share.",
    label: "HEAVIEST WHEEL LOAD",
    unit: "kN",
    low: "0 kN",
    high: "12 kN / wheel",
    caption: "LIGHT → HEAVY · ESTIMATED",
  },
  aero: {
    title: "Downforce model",
    description:
      "Double the speed, quadruple the aero load. Colour follows estimated total downforce, not a pressure map.",
    label: "ESTIMATED DOWNFORCE",
    unit: "kN",
    low: "0 kN",
    high: "15 kN",
    caption: "LOW → HIGH · ESTIMATED",
  },
  clean: {
    title: "Chassis & measured speed",
    description:
      "A stylised open-wheeler. Orbit around the chassis, explore the aero surfaces, or switch to a top-down view.",
    label: "VEHICLE SPEED",
    unit: "km/h",
    low: "",
    high: "",
    caption: "",
  },
};

function selectLayer(next: Layer) {
  const changed = layer !== next;
  el("trace-inspection").hidden = true;
  layer = next;
  if (sample) car?.setLayer(next);
  document
    .querySelectorAll<HTMLButtonElement>("[data-layer]")
    .forEach((button) => {
      const selected = button.dataset.layer === next;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  const info = layerInfo[next];
  text("layer-title", info.title);
  text("layer-description", info.description);
  text("layer-badge", next === "clean" ? "MEASURED SPEED" : "PHYSICS ESTIMATE");
  text("measure-label", info.label);
  text("measure-unit", info.unit);
  const range = summaries?.[next];
  text(
    "legend-low",
    range ? `${displayValue(range.min)} ${info.unit}` : info.low,
  );
  text(
    "legend-high",
    range ? `${displayValue(range.max)} ${info.unit}` : info.high,
  );
  text("legend-caption", "SHARED LAP-RELATIVE SCALE");
  text(
    "trace-channel",
    `${channelNames[next].toUpperCase()}${next === "clean" ? "" : " · EST."}`,
  );
  text("trace-unit", info.unit);
  text(
    "track-channel",
    `${channelNames[next]}${next === "clean" ? "" : " · est."}`,
  );
  el("trace").setAttribute(
    "aria-label",
    `${channelNames[next]} over the complete lap, coloured from lap minimum to maximum`,
  );
  el("track").setAttribute(
    "aria-label",
    `Track map coloured by ${channelNames[next].toLowerCase()} with current car position`,
  );
  el("jump-peak").setAttribute(
    "aria-label",
    `Jump to ${channelNames[next].toLowerCase()} peak`,
  );
  el<HTMLButtonElement>("jump-peak").disabled = !range;
  el("peak-note").hidden = next !== "brakes" || !range || range.peakTime !== 0;
  if (range) {
    text("peak-value", `${displayValue(range.max)} ${info.unit}`);
    text("peak-time", formatTime(range.peakTime));
    el<HTMLButtonElement>("jump-peak").disabled = false;
    ["FL", "FR", "RL", "RR"].forEach((wheel, i) =>
      text(
        `wheel-peak-${wheel}`,
        `LAP MAX ${displayValue(range.wheelPeaks[i] ?? 0)}`,
      ),
    );
  }
  drawTrace();
  if (sample) drawTrack(sample);
  el("heat-legend").hidden = next === "clean";
  el("wheel-readouts").hidden = next === "clean" || next === "aero";
  el("wheel-trace-key").hidden = next === "clean" || next === "aero";
  document.querySelectorAll(".wheel-unit").forEach((unit) => {
    unit.textContent = next === "loads" ? "kN" : "°C";
  });
  document.querySelector(".estimate-pill")!.textContent =
    next === "clean" ? "DATA" : "EST.";
  if (sample) updateReadouts(sample);
  if (changed) reveal(document.querySelector(".stage-measure"));
}

document
  .querySelectorAll<HTMLButtonElement>("[data-layer]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      selectLayer(button.dataset.layer as Layer),
    ),
  );
function selectCamera(view: "orbit" | "top" | "side") {
  car?.setCamera(view);
  document
    .querySelectorAll<HTMLButtonElement>("[data-camera]")
    .forEach((button) => {
      button.classList.toggle("active", button.dataset.camera === view);
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.camera === view),
      );
    });
}
document
  .querySelectorAll<HTMLButtonElement>("[data-camera]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      selectCamera(button.dataset.camera as "orbit" | "top" | "side"),
    ),
  );
el("reset-view").addEventListener("click", () => selectCamera("orbit"));
for (const id of ["methodology", "model-link", "footer-method"])
  el(id).addEventListener("click", () => {
    setPlaying(false);
    dialog.showModal();
    reveal(dialog);
  });
el("close-dialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (
    event.target === dialog &&
    (event.clientX < dialog.getBoundingClientRect().left ||
      event.clientX > dialog.getBoundingClientRect().right ||
      event.clientY < dialog.getBoundingClientRect().top ||
      event.clientY > dialog.getBoundingClientRect().bottom)
  )
    dialog.close();
});

function setPlaying(value: boolean) {
  playing = value && !!lap;
  playButton.innerHTML = icon(playing ? "pause" : "play", 22);
  playButton.setAttribute("aria-label", playing ? "Pause lap" : "Play lap");
  text(
    "playback-state",
    playing
      ? "PLAYING LAP"
      : time >= (lap?.session.lapTime ?? Infinity)
        ? "LAP COMPLETE"
        : "PAUSED",
  );
  el("playback-state").classList.toggle("playing", playing);
}
function togglePlay() {
  if (!lap) return;
  if (time >= lap.session.lapTime) seek(0);
  setPlaying(!playing);
}
function seek(value: number) {
  if (!lap) return;
  el("trace-inspection").hidden = true;
  time = clamp(value, 0, lap.session.lapTime);
  sample = sampleAt(lap.samples, time);
  car?.update(sample, 0);
  updateReadouts(sample);
  drawTrack(sample);
  if (!playing || time === lap.session.lapTime) setPlaying(false);
}
playButton.addEventListener("click", togglePlay);
scrubber.addEventListener("input", () => seek(Number(scrubber.value)));
dockScrubber.addEventListener("input", () => seek(Number(dockScrubber.value)));
scrubber.addEventListener("pointermove", (event) => {
  if (!lap || event.buttons || event.pointerType === "touch") return;
  const bounds = scrubber.getBoundingClientRect();
  const fraction = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
  const inspectedTime = fraction * lap.session.lapTime;
  const inspected = sampleAt(lap.samples, inspectedTime);
  text("inspect-time", formatTime(inspectedTime));
  text(
    "inspect-value",
    `${displayValue(layerValue(inspected, layer))} ${layerInfo[layer].unit}${layer === "clean" ? "" : " · EST."}`,
  );
  const tooltip = el("trace-inspection");
  tooltip.hidden = false;
  tooltip.style.left = `${clamp(fraction * bounds.width + 12, 0, Math.max(0, bounds.width - tooltip.offsetWidth))}px`;
});
for (const event of ["pointerleave", "pointerdown", "blur"])
  scrubber.addEventListener(event, () => {
    el("trace-inspection").hidden = true;
  });
el("skip-back").addEventListener("click", () => seek(time - 5));
el("skip-next").addEventListener("click", () => seek(time + 5));
el("jump-peak").addEventListener("click", () => {
  if (!summaries) return;
  setPlaying(false);
  seek(summaries[layer].peakTime);
  reveal(document.querySelector(".stage-measure"));
});
el("rate").addEventListener("click", () => {
  const rates = [0.25, 0.5, 1, 2];
  rate = rates[(rates.indexOf(rate) + 1) % rates.length];
  text("rate", `${rate}×`);
  el("rate").setAttribute("aria-label", `Playback speed: ${rate} times`);
});
document.addEventListener("keydown", (event) => {
  if (
    dialog.open ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLButtonElement ||
    event.target instanceof HTMLAnchorElement ||
    (event.target instanceof Element &&
      !!event.target.closest("summary, [contenteditable=true]"))
  )
    return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlay();
  }
  if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
    event.preventDefault();
    seek(time + (event.code === "ArrowLeft" ? -1 : 1));
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) setPlaying(false);
});

function updateReadouts(s: Sample) {
  lastReadoutSample = s;
  text("speed", Math.round(s.speed));
  text("gear", s.gear || "N");
  text("throttle", `${Math.round(s.throttle)}%`);
  text("brake", s.brake ? "ON" : "OFF");
  el("throttle-bar").style.width = `${clamp(s.throttle, 0, 100)}%`;
  el("brake-bar").style.width = s.brake ? "100%" : "0%";
  text("rpm", Math.round(s.rpm).toLocaleString("en-US"));
  text("lat-g", `${s.latG > 0 ? "+" : ""}${s.latG.toFixed(1)}g`);
  text("long-g", `${s.longG > 0 ? "+" : ""}${s.longG.toFixed(1)}g`);
  text("current-time", formatTime(time));
  text("cursor-time", formatTime(time));
  text("track-distance", `${Math.round(s.distance).toLocaleString("en-US")} m`);
  const value = layerValue(s, layer);
  text("measure-value", displayValue(value));
  const intensity = summaries ? heatIntensity(value, summaries[layer]) : 0;
  const color = channelColor(s);
  el("measure-value").style.color = color;
  el("intensity-fill").style.width = `${intensity * 100}%`;
  el("intensity-fill").style.background = color;
  text(
    "intensity-state",
    `${Math.round(intensity * 100)}% OF LAP RANGE${intensity >= 0.995 ? " · PEAK" : ""}`,
  );
  el("intensity-state").style.color = color;
  el("jump-peak").classList.toggle("at-peak", intensity >= 0.995);
  ["FL", "FR", "RL", "RR"].forEach((wheel, i) => {
    const selected = layer === "loads" ? "loads" : "brakes";
    const wheelValue = selected === "loads" ? s.loads[i] : s.brakeTemp[i];
    const level = summaries
      ? heatIntensity(wheelValue, summaries[selected])
      : 0;
    const wheelColor = heatColorHex(level);
    text(`wheel-${wheel}`, displayValue(wheelValue, selected));
    el(`wheel-card-${wheel}`).style.setProperty("--wheel-heat", wheelColor);
    el(`wheel-fill-${wheel}`).style.width = `${level * 100}%`;
  });
  if (lap) {
    const progress = (time / lap.session.lapTime) * 100;
    el("trace-cursor").style.left = `${progress}%`;
    el("trace-cursor").classList.toggle("near-end", progress > 85);
    const accessibleValue = `${formatTime(time)} of ${formatTime(lap.session.lapTime)}; ${channelNames[layer]} ${displayValue(value)} ${layerInfo[layer].unit}${layer === "clean" ? ", measured" : ", estimated"}`;
    for (const control of [scrubber, dockScrubber]) {
      control.value = String(time);
      control.setAttribute("aria-valuetext", accessibleValue);
    }
    text("trace-readout", accessibleValue);
    const sector =
      time < lap.session.sectors[0]
        ? 1
        : time < lap.session.sectors[0] + lap.session.sectors[1]
          ? 2
          : 3;
    text("sector-badge", `S${sector}`);
    [...el("sector-strip").children].forEach((child, i) =>
      child.classList.toggle("active", i === sector - 1),
    );
  }
}

function canvasContext(id: string) {
  const canvas = el<HTMLCanvasElement>(id);
  const { width, height } = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio, 2);
  if (
    canvas.width !== Math.round(width * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function drawTrace() {
  if (!lap || !summaries) return;
  const { ctx, width, height } = canvasContext("trace");
  const range = summaries[layer];
  [...el("time-axis").children].forEach((tick, i) => {
    tick.textContent = `${((lap!.session.lapTime * i) / 4).toFixed(i === 0 ? 0 : 1)}s`;
  });
  const y = (value: number) =>
    height - 12 - heatIntensity(value, range) * (height - 25);
  const x = (t: number) => (t / lap!.session.lapTime) * width;
  const ticks = [range.max, (range.min + range.max) / 2, range.min];
  document.querySelectorAll(".trace-scale span").forEach((span, i) => {
    span.textContent = displayValue(ticks[i]);
  });
  ctx.strokeStyle = "#43483e";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  for (const value of ticks) {
    ctx.beginPath();
    ctx.moveTo(0, y(value));
    ctx.lineTo(width, y(value));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const gradient = ctx.createLinearGradient(0, 0, Math.max(1, width), 0);
  lap.samples.forEach((s) =>
    gradient.addColorStop(
      clamp(s.t / lap!.session.lapTime, 0, 1),
      channelColor(s),
    ),
  );
  ctx.beginPath();
  lap.samples.forEach((s, i) => {
    if (i) ctx.lineTo(x(s.t), y(layerValue(s, layer)));
    else ctx.moveTo(x(s.t), y(layerValue(s, layer)));
  });
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.lineTo(width, height - 8);
  ctx.lineTo(0, height - 8);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.globalAlpha = 0.22;
  ctx.fill();
  ctx.globalAlpha = 1;
  if (layer === "brakes" || layer === "loads") {
    ctx.strokeStyle = "#f2f6e870";
    ctx.lineWidth = 1;
    for (let wheel = 0; wheel < 4; wheel++) {
      ctx.beginPath();
      lap.samples.forEach((s, i) => {
        const value = layer === "brakes" ? s.brakeTemp[wheel] : s.loads[wheel];
        if (i) ctx.lineTo(x(s.t), y(value));
        else ctx.moveTo(x(s.t), y(value));
      });
      ctx.stroke();
    }
  }
  ctx.fillStyle = "#ff3428";
  for (let i = 0; i < lap.samples.length - 1; i++) {
    const s = lap.samples[i];
    if (s.brake)
      ctx.fillRect(
        x(s.t),
        height - 4,
        Math.max(1, x(lap.samples[i + 1].t) - x(s.t)),
        4,
      );
  }
  ctx.strokeStyle = "#768464";
  ctx.setLineDash([3, 4]);
  for (const boundary of [
    lap.session.sectors[0],
    lap.session.sectors[0] + lap.session.sectors[1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x(boundary), 0);
    ctx.lineTo(x(boundary), height);
    ctx.stroke();
  }
  ctx.strokeStyle = "#ff483b";
  ctx.beginPath();
  ctx.moveTo(x(range.peakTime), 0);
  ctx.lineTo(x(range.peakTime), height);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#ff160a";
  ctx.beginPath();
  ctx.arc(x(range.peakTime), y(range.max), 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawTrack(current: Sample) {
  if (!lap) return;
  const { ctx, width, height } = canvasContext("track");
  const xs = lap.samples.map((s) => s.x),
    ys = lap.samples.map((s) => s.y);
  const minX = Math.min(...xs),
    minY = Math.min(...ys),
    maxX = Math.max(...xs),
    maxY = Math.max(...ys);
  const scale = Math.min(
    (width - 32) / Math.max(maxX - minX, 1),
    (height - 24) / Math.max(maxY - minY, 1),
  );
  const point = (s: Sample) => [
    width / 2 + (s.x - (minX + maxX) / 2) * scale,
    height / 2 - (s.y - (minY + maxY) / 2) * scale,
  ];
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  lap.samples.forEach((s, i) => {
    const [x, y] = point(s);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#30382f";
  ctx.stroke();
  ctx.lineWidth = 4.5;
  for (let i = 1; i < lap.samples.length; i++) {
    const a = point(lap.samples[i - 1]),
      b = point(lap.samples[i]);
    ctx.strokeStyle = channelColor(lap.samples[i]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  if (summaries) {
    const peak = point(sampleAt(lap.samples, summaries[layer].peakTime));
    ctx.strokeStyle = "#ff483b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(peak[0], peak[1], 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  const start = point(lap.samples[0]);
  ctx.fillStyle = "#e9eee0";
  ctx.fillRect(start[0] - 3, start[1] - 3, 6, 6);
  const [x, y] = point(current);
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#d2ee8628";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 4.3, 0, Math.PI * 2);
  ctx.fillStyle = "#f3f4df";
  ctx.fill();
  ctx.strokeStyle = "#182116";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

const chartObserver = new ResizeObserver(() => {
  drawTrace();
  if (sample) drawTrack(sample);
});
chartObserver.observe(el("trace"));
chartObserver.observe(el("track"));

function clearLapState() {
  stopMotion();
  el("trace-inspection").hidden = true;
  el("workspace").setAttribute("aria-busy", "true");
  text("trace-readout", "Awaiting telemetry.");
  [...el("time-axis").children].forEach((tick) => {
    tick.textContent = "—";
  });
  setPlaying(false);
  lap = null;
  sample = null;
  summaries = null;
  time = 0;
  car?.clearTelemetry();
  el("car-canvas")
    .querySelector("canvas")
    ?.setAttribute("aria-label", "3D car awaiting telemetry");
  for (const id of ["play", "skip-back", "skip-next", "jump-peak", "rate"])
    el<HTMLButtonElement>(id).disabled = true;
  for (const control of [scrubber, dockScrubber]) {
    control.disabled = true;
    control.value = "0";
    control.max = "1";
    control.removeAttribute("aria-valuetext");
  }
  const corner = el<HTMLSelectElement>("corner-select");
  corner.disabled = true;
  corner.replaceChildren(new Option("Select corner…", ""));
  for (const id of [
    "speed",
    "gear",
    "throttle",
    "brake",
    "rpm",
    "lat-g",
    "long-g",
    "measure-value",
    "lap-time",
    "duration",
    "compound",
    "tyre-age",
    "air-temp",
    "track-temp",
    "dialog-source",
    "peak-value",
    "peak-time",
    "legend-low",
    "legend-high",
    "track-distance",
    "sector-badge",
    "turn-count",
    "context-sampling",
    "data-quality",
  ])
    text(id, "—");
  for (const wheel of ["FL", "FR", "RL", "RR"]) {
    text(`wheel-${wheel}`, "—");
    text(`wheel-peak-${wheel}`, "LAP MAX —");
    el(`wheel-fill-${wheel}`).style.width = "0%";
    el(`wheel-card-${wheel}`).style.removeProperty("--wheel-heat");
  }
  for (const id of ["throttle-bar", "brake-bar", "intensity-fill"])
    el(id).style.width = "0%";
  el("measure-value").style.removeProperty("color");
  el("intensity-state").style.removeProperty("color");
  el("compound-dot").style.background = "#777";
  text("intensity-state", "AWAITING TELEMETRY");
  text(
    "context-model",
    "Uncalibrated physics estimates, not measured team performance.",
  );
  text("current-time", "0:00.000");
  text("cursor-time", "0:00.000");
  text("playback-state", "AWAITING TELEMETRY");
  el("trace-cursor").style.left = "0%";
  el("trace-cursor").classList.remove("near-end");
  el("sector-strip").replaceChildren();
  el("jump-peak").classList.remove("at-peak");
  el("peak-note").hidden = true;
  document.querySelectorAll(".trace-scale span").forEach((span) => {
    span.textContent = "—";
  });
  canvasContext("track");
  canvasContext("trace");
  status.className = "data-status";
  status.textContent = "Loading real FastF1 telemetry…";
  el("retry-load").hidden = true;
}

function showLoadError(error: unknown) {
  clearLapState();
  status.classList.add("error");
  el("workspace").setAttribute("aria-busy", "false");
  status.textContent =
    "Lap data unavailable. No simulated telemetry is being displayed. Choose another driver or retry.";
  text("playback-state", "DATA UNAVAILABLE");
  el("retry-load").hidden = false;
  console.error(error);
}

function renderSelection(circuit: CatalogCircuit, driver: CatalogDriver) {
  const focusedDriver =
    document.activeElement instanceof HTMLElement
      ? document.activeElement.dataset.driver
      : undefined;
  selectedCircuit = circuit;
  selectedDriver = driver;
  el<HTMLSelectElement>("circuit-select").value = circuit.id;
  const drivers = el<HTMLSelectElement>("driver-select");
  drivers.replaceChildren(
    ...circuit.drivers.map(
      (item) => new Option(`${item.name} · ${item.team}`, item.id),
    ),
  );
  drivers.value = driver.id;
  drivers.disabled = false;
  text("circuit-name", circuit.name);
  text("stage-watermark", circuit.name.toUpperCase());
  text("track-title", circuit.circuitName);
  text("circuit-character", circuit.character);
  text("session-year", `${circuit.year} WORLD CHAMPIONSHIP`);
  text("driver-name", driver.name);
  text("team", driver.team);
  el("team-swatch").style.background = driver.color;
  el("circuit-flag").className = `flag-monaco flag-${circuit.id}`;
  el("selection-notes").textContent = circuit.selectionNotes?.join(" ") ?? "";
  el("selection-notes").hidden = !circuit.selectionNotes?.length;
  el("driver-grid").replaceChildren(
    ...circuit.drivers.map((item) => {
      const button = document.createElement("button");
      button.className = "driver-card";
      button.dataset.driver = item.id;
      button.style.setProperty("--team-color", item.color);
      button.setAttribute("aria-pressed", String(item.id === driver.id));
      const name = document.createElement("strong"),
        team = document.createElement("span"),
        timing = document.createElement("b");
      name.textContent = item.name;
      team.textContent = item.team;
      timing.textContent = formatTime(item.lapTime);
      button.append(name, team, timing);
      button.addEventListener("click", () => {
        void loadSelection(circuit, item);
      });
      return button;
    }),
  );
  if (focusedDriver)
    el("driver-grid")
      .querySelector<HTMLButtonElement>(`[data-driver="${focusedDriver}"]`)
      ?.focus({ preventScroll: true });
  reveal(el("driver-grid").querySelector('[aria-pressed="true"]'), true);
}

async function loadSelection(circuit: CatalogCircuit, driver: CatalogDriver) {
  const version = ++loadVersion;
  loadController?.abort();
  const controller = (loadController = new AbortController());
  clearLapState();
  renderSelection(circuit, driver);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${driver.path}`, {
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`Lap data request returned HTTP ${response.status}.`);
    const next = validateLap(await response.json());
    if (version !== loadVersion) return;
    if (
      next.session.year !== circuit.year ||
      next.session.driver !== driver.id ||
      next.session.driverName !== driver.name ||
      next.session.team !== driver.team ||
      next.session.teamColor?.toLowerCase() !== driver.color.toLowerCase() ||
      Math.abs(next.session.lapTime - driver.lapTime) > 0.001
    )
      throw new Error("Lap does not match selected catalog entry.");
    lap = next;
    summaries = Object.fromEntries(
      (["brakes", "loads", "aero", "clean"] as const).map((selected) => [
        selected,
        summarizeLayer(lap!.samples, selected),
      ]),
    ) as Record<Layer, LayerSummary>;
    car?.setTelemetry(lap.samples);
    car?.setTeamColor(driver.color);
    car?.setLayer(layer);
    el("car-canvas")
      .querySelector("canvas")
      ?.setAttribute(
        "aria-label",
        `${driver.team} team-inspired 3D open-wheel car. Drag to orbit, scroll to zoom.`,
      );
    text(
      "turn-count",
      lap.corners.length
        ? `${lap.corners.length} TURNS`
        : "CORNERS UNAVAILABLE",
    );
    text("context-sampling", lap.sampling);
    text("context-model", String(lap.model.description));
    const qualityValue = (key: string) => {
      const value = lap?.quality?.[key];
      return typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "—";
    };
    text(
      "data-quality",
      `Longest unchanged car-channel span: ${qualityValue("longestUnchangedCarChannelsS")} s (rejection gate: ${qualityValue("unchangedChannelGateS")} s). Throttle samples bounded to 0–100%: ${qualityValue("throttleClampedPlaybackSamples")}. Limited derivative samples: lateral ${qualityValue("lateralClippedSamples")}, longitudinal ${qualityValue("longitudinalClippedSamples")} (padded grid). Passing these checks does not establish measurement accuracy.`,
    );
    const corner = el<HTMLSelectElement>("corner-select");
    corner.replaceChildren(
      new Option("Select corner…", ""),
      ...lap.corners.map(
        (item) =>
          new Option(`T${item.number}${item.letter}`, String(item.distance)),
      ),
    );
    corner.disabled = !lap.corners.length;
    document.querySelector<HTMLElement>(".heat-gradient")!.style.background =
      `linear-gradient(90deg, ${HEAT_STOPS.join(", ")})`;
    selectLayer(layer);
    const session = lap.session;
    text("session-year", `${session.year} WORLD CHAMPIONSHIP`);
    text("driver-name", session.driverName);
    text("team", session.team);
    text("lap-time", formatTime(session.lapTime));
    text("duration", formatTime(session.lapTime));
    text(
      "compound",
      session.compound.charAt(0) + session.compound.slice(1).toLowerCase(),
    );
    text("tyre-age", `${session.tyreLife} laps old`);
    text("air-temp", session.airTemp === null ? "—" : `${session.airTemp}°C`);
    text(
      "track-temp",
      session.trackTemp === null ? "—" : `${session.trackTemp}°C`,
    );
    el("compound-dot").style.background =
      (
        {
          SOFT: "#f57668",
          MEDIUM: "#edc857",
          HARD: "#ecece6",
          INTERMEDIATE: "#78b77b",
          WET: "#78a8ce",
        } as Record<string, string>
      )[session.compound] ?? "#999";
    text(
      "dialog-source",
      `${session.year} ${session.event} · ${session.name} · ${session.driverName} (${session.driver}) · lap ${session.lapNumber} · ${formatTime(session.lapTime)}. Source: FastF1. ${lap.samples.length} resampled points. Air ${session.airTemp ?? "—"}°C / track ${session.trackTemp ?? "—"}°C.`,
    );
    for (const control of [scrubber, dockScrubber]) {
      control.max = String(session.lapTime);
      control.disabled = false;
    }
    el<HTMLButtonElement>("rate").disabled = false;
    playButton.disabled = false;
    el<HTMLButtonElement>("skip-back").disabled = false;
    el<HTMLButtonElement>("skip-next").disabled = false;
    el("sector-strip").innerHTML = session.sectors
      .map(
        (seconds, i) =>
          `<button style="flex:${seconds}" data-sector="${i}" aria-label="Jump to sector ${i + 1}"><span>S${i + 1}</span><strong>${seconds.toFixed(3)}</strong></button>`,
      )
      .join("");
    el("sector-strip")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((button) =>
        button.addEventListener("click", () =>
          seek(
            session.sectors
              .slice(0, Number(button.dataset.sector))
              .reduce((a, b) => a + b, 0),
          ),
        ),
      );
    status.classList.add("loaded");
    status.textContent = "FastF1 archive loaded. Playback paused.";
    el("workspace").setAttribute("aria-busy", "false");
    seek(0);
    setPlaying(false);
    drawTrace();
    reveal(document.querySelector(".inputs-panel"));
  } catch (error) {
    if (version !== loadVersion || controller.signal.aborted) return;
    showLoadError(error);
  }
}

async function loadCatalog() {
  const version = ++loadVersion;
  loadController?.abort();
  const controller = (loadController = new AbortController());
  clearLapState();
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}catalog.json`, {
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`Catalog request returned HTTP ${response.status}.`);
    const next = validateCatalog(await response.json());
    if (version !== loadVersion) return;
    catalog = next;
    const circuits = el<HTMLSelectElement>("circuit-select");
    circuits.replaceChildren(
      ...catalog.circuits.map(
        (circuit) =>
          new Option(`${circuit.name} · ${circuit.year}`, circuit.id),
      ),
    );
    circuits.disabled = false;
    const initial = catalog.circuits.find(
      (circuit) => circuit.id === catalog!.defaultCircuit,
    )!;
    await loadSelection(initial, initial.drivers[0]);
  } catch (error) {
    if (version !== loadVersion || controller.signal.aborted) return;
    showLoadError(error);
  }
}

el("circuit-select").addEventListener("change", () => {
  const circuit = catalog?.circuits.find(
    (item) => item.id === el<HTMLSelectElement>("circuit-select").value,
  );
  if (circuit)
    void loadSelection(
      circuit,
      circuit.drivers.find((item) => item.id === selectedDriver?.id) ??
        circuit.drivers[0],
    );
});
el("driver-select").addEventListener("change", () => {
  const driver = selectedCircuit?.drivers.find(
    (item) => item.id === el<HTMLSelectElement>("driver-select").value,
  );
  if (driver && selectedCircuit) void loadSelection(selectedCircuit, driver);
});
el("corner-select").addEventListener("change", () => {
  const selector = el<HTMLSelectElement>("corner-select");
  if (!lap || !selector.value) return;
  const distance = Number(selector.value);
  const nearest = lap.samples.reduce((best, point) =>
    Math.abs(point.distance - distance) < Math.abs(best.distance - distance)
      ? point
      : best,
  );
  setPlaying(false);
  seek(nearest.t);
  selector.value = "";
});
el("retry-load").addEventListener("click", () => {
  if (selectedCircuit && selectedDriver)
    void loadSelection(selectedCircuit, selectedDriver);
  else void loadCatalog();
});

function animate(now: number) {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  if (playing && lap) {
    time = Math.min(time + dt * rate, lap.session.lapTime);
    sample = sampleAt(lap.samples, time);
    if (time >= lap.session.lapTime) setPlaying(false);
  }
  car?.update(sample, playing ? dt * rate : 0);
  if (sample && sample !== lastReadoutSample && now - lastUi >= 50) {
    updateReadouts(sample);
    drawTrack(sample);
    lastUi = now;
  }
  frame = requestAnimationFrame(animate);
}
frame = requestAnimationFrame(animate);
void loadCatalog();

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    loadController?.abort();
    cancelAnimationFrame(frame);
    chartObserver.disconnect();
    transportObserver.disconnect();
    disposeMotion();
    car?.dispose();
  });
