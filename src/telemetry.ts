export interface Sample {
  t: number;
  distance: number;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  drs: number;
  x: number;
  y: number;
  latG: number;
  longG: number;
  downforce: number;
  loads: number[];
  brakeTemp: number[];
}

export interface Lap {
  schemaVersion: number;
  source: string;
  synthetic: false;
  session: {
    year: number;
    event: string;
    name: string;
    driver: string;
    driverName: string;
    team: string;
    teamColor?: string;
    lapNumber: number;
    lapTime: number;
    compound: string;
    tyreLife: number;
    sectors: number[];
    airTemp: number | null;
    trackTemp: number | null;
  };
  model: Record<string, unknown>;
  quality?: Record<string, unknown>;
  sampling: string;
  corners: { number: number; letter: string; distance: number }[];
  samples: Sample[];
}

export interface CatalogDriver {
  id: string;
  name: string;
  team: string;
  color: string;
  lapTime: number;
  path: string;
}

export interface CatalogCircuit {
  id: string;
  name: string;
  event: string;
  circuitName: string;
  character: string;
  year: number;
  drivers: CatalogDriver[];
  selectionNotes?: string[];
}

export interface Catalog {
  schemaVersion: 1;
  defaultCircuit: string;
  circuits: CatalogCircuit[];
}

export function validateCatalog(input: unknown): Catalog {
  const catalog = input as Catalog;
  const nonempty = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
  if (
    !catalog ||
    catalog.schemaVersion !== 1 ||
    !Array.isArray(catalog.circuits) ||
    !catalog.circuits.length
  )
    throw new Error("Invalid lap catalog.");
  const circuitIds = new Set<string>();
  for (const circuit of catalog.circuits) {
    if (
      !circuit ||
      !nonempty(circuit.id) ||
      !/^[a-z]+$/.test(circuit.id) ||
      circuitIds.has(circuit.id) ||
      !Number.isInteger(circuit.year) ||
      circuit.year < 1950 ||
      ![
        circuit.name,
        circuit.event,
        circuit.circuitName,
        circuit.character,
      ].every(nonempty) ||
      !Array.isArray(circuit.drivers) ||
      !circuit.drivers.length ||
      (circuit.selectionNotes !== undefined &&
        (!Array.isArray(circuit.selectionNotes) ||
          !circuit.selectionNotes.every(nonempty)))
    )
      throw new Error("Invalid catalog circuit.");
    circuitIds.add(circuit.id);
    const ids = new Set<string>(),
      teams = new Set<string>();
    let previous = 0;
    for (const driver of circuit.drivers) {
      if (
        !driver ||
        !nonempty(driver.id) ||
        !/^[A-Z0-9]{2,3}$/.test(driver.id) ||
        ids.has(driver.id) ||
        ![driver.name, driver.team].every(nonempty) ||
        teams.has(driver.team) ||
        typeof driver.color !== "string" ||
        !/^#[0-9a-fA-F]{6}$/.test(driver.color) ||
        !Number.isFinite(driver.lapTime) ||
        driver.lapTime <= 0 ||
        driver.lapTime < previous ||
        driver.path !==
          `laps/${circuit.year}-${circuit.id}-${driver.id.toLowerCase()}.json`
      )
        throw new Error("Invalid catalog driver or asset path.");
      ids.add(driver.id);
      teams.add(driver.team);
      previous = driver.lapTime;
    }
  }
  if (!circuitIds.has(catalog.defaultCircuit))
    throw new Error("Invalid default circuit.");
  return catalog;
}

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export type Layer = "brakes" | "loads" | "aero" | "clean";
export interface LayerSummary {
  min: number;
  max: number;
  peakTime: number;
  wheelPeaks: number[];
}

export function layerValues(sample: Sample, layer: Layer): number[] {
  return layer === "brakes"
    ? sample.brakeTemp
    : layer === "loads"
      ? sample.loads
      : [layer === "aero" ? sample.downforce : sample.speed];
}

export function layerValue(sample: Sample, layer: Layer) {
  return Math.max(...layerValues(sample, layer));
}

export function summarizeLayer(samples: Sample[], layer: Layer): LayerSummary {
  if (!samples.length) throw new Error("No samples to summarise.");
  const result: LayerSummary = {
    min: Infinity,
    max: -Infinity,
    peakTime: samples[0].t,
    wheelPeaks: [],
  };
  for (const sample of samples) {
    layerValues(sample, layer).forEach((value, i) => {
      result.min = Math.min(result.min, value);
      result.wheelPeaks[i] = Math.max(result.wheelPeaks[i] ?? -Infinity, value);
      if (value > result.max) {
        result.max = value;
        result.peakTime = sample.t;
      }
    });
  }
  return result;
}

export function heatIntensity(
  value: number,
  range: Pick<LayerSummary, "min" | "max">,
) {
  return range.max > range.min
    ? clamp((value - range.min) / (range.max - range.min), 0, 1)
    : 0;
}

export const HEAT_STOPS = [
  "#00bfff",
  "#28ed8c",
  "#ffcf00",
  "#ff7100",
  "#ff160a",
];

export function heatColorHex(intensity: number) {
  const position = clamp(intensity, 0, 1) * (HEAT_STOPS.length - 1);
  const index = Math.min(Math.floor(position), HEAT_STOPS.length - 2);
  const fraction = position - index;
  const a = parseInt(HEAT_STOPS[index].slice(1), 16),
    b = parseInt(HEAT_STOPS[index + 1].slice(1), 16);
  return (
    "#" +
    [16, 8, 0]
      .map((shift) =>
        Math.round(
          ((a >> shift) & 255) * (1 - fraction) +
            ((b >> shift) & 255) * fraction,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export function formatTime(seconds: number) {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

export function sampleAt(samples: Sample[], time: number): Sample {
  if (!samples.length) throw new Error("No telemetry samples available.");
  if (time <= samples[0].t) return samples[0];
  if (time >= samples.at(-1)!.t) return samples.at(-1)!;
  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (samples[mid].t <= time) low = mid;
    else high = mid;
  }
  const a = samples[low];
  const b = samples[high];
  const fraction = (time - a.t) / (b.t - a.t);
  const mix = (start: number, end: number) => start + (end - start) * fraction;
  return {
    t: time,
    distance: mix(a.distance, b.distance),
    speed: mix(a.speed, b.speed),
    throttle: mix(a.throttle, b.throttle),
    brake: a.brake,
    gear: a.gear,
    rpm: mix(a.rpm, b.rpm),
    drs: a.drs,
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    latG: mix(a.latG, b.latG),
    longG: mix(a.longG, b.longG),
    downforce: mix(a.downforce, b.downforce),
    loads: a.loads.map((v, i) => mix(v, b.loads[i])),
    brakeTemp: a.brakeTemp.map((v, i) => mix(v, b.brakeTemp[i])),
  };
}

export function validateLap(input: unknown): Lap {
  const lap = input as Lap;
  const finite = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v);
  if (
    !lap ||
    lap.schemaVersion !== 1 ||
    lap.source !== "FastF1" ||
    lap.synthetic !== false ||
    !lap.session ||
    !finite(lap.session.lapTime) ||
    lap.session.lapTime <= 0 ||
    !Array.isArray(lap.samples) ||
    lap.samples.length < 2 ||
    !lap.model ||
    typeof lap.sampling !== "string"
  ) {
    throw new Error("Expected a real FastF1 lap export (schema version 1).");
  }
  for (const key of [
    "event",
    "name",
    "driver",
    "driverName",
    "team",
    "compound",
  ] as const) {
    if (typeof lap.session[key] !== "string" || !lap.session[key].trim())
      throw new Error(`Missing session ${key}.`);
  }
  if (
    !finite(lap.session.year) ||
    !Array.isArray(lap.session.sectors) ||
    lap.session.sectors.length !== 3 ||
    !lap.session.sectors.every((v) => finite(v) && v > 0) ||
    !Array.isArray(lap.corners) ||
    !Number.isInteger(lap.session.year) ||
    !Number.isInteger(lap.session.lapNumber) ||
    lap.session.lapNumber <= 0 ||
    !finite(lap.session.tyreLife) ||
    lap.session.tyreLife < 0 ||
    ![lap.session.airTemp, lap.session.trackTemp].every(
      (value) => value === null || finite(value),
    ) ||
    (lap.session.teamColor !== undefined &&
      !/^#[0-9a-fA-F]{6}$/.test(lap.session.teamColor)) ||
    Math.abs(
      lap.session.sectors.reduce((a, b) => a + b, 0) - lap.session.lapTime,
    ) > 0.01 ||
    lap.corners.some(
      (corner) =>
        !corner ||
        !Number.isInteger(corner.number) ||
        corner.number <= 0 ||
        typeof corner.letter !== "string" ||
        !finite(corner.distance) ||
        corner.distance < 0,
    )
  ) {
    throw new Error("Invalid session metadata.");
  }
  const numeric = [
    "t",
    "distance",
    "speed",
    "throttle",
    "brake",
    "gear",
    "rpm",
    "drs",
    "x",
    "y",
    "latG",
    "longG",
    "downforce",
  ] as const;
  lap.samples.forEach((sample, i) => {
    if (
      !sample ||
      numeric.some((key) => !finite(sample[key])) ||
      [sample.loads, sample.brakeTemp].some(
        (values) =>
          !Array.isArray(values) ||
          values.length !== 4 ||
          !values.every(finite),
      ) ||
      [
        sample.t,
        sample.distance,
        sample.speed,
        sample.rpm,
        sample.downforce,
      ].some((value) => value < 0) ||
      sample.throttle < 0 ||
      sample.throttle > 100 ||
      ![0, 1].includes(sample.brake) ||
      !Number.isInteger(sample.gear) ||
      sample.gear < 0 ||
      sample.gear > 8 ||
      !Number.isInteger(sample.drs) ||
      sample.drs < 0 ||
      sample.loads.some((value) => value < 0) ||
      (i > 0 &&
        (sample.t <= lap.samples[i - 1].t ||
          sample.distance < lap.samples[i - 1].distance))
    )
      throw new Error(`Invalid telemetry at sample ${i}.`);
  });
  if (
    Math.abs(lap.samples[0].t) > 0.01 ||
    Math.abs(lap.samples.at(-1)!.t - lap.session.lapTime) > 0.02
  ) {
    throw new Error("Telemetry does not cover the complete lap.");
  }
  return lap;
}
