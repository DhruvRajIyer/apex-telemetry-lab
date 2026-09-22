import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatTime,
  sampleAt,
  validateLap,
  validateCatalog,
  summarizeLayer,
  layerValue,
  heatIntensity,
  heatColorHex,
  type Sample,
} from "./telemetry.ts";

const first: Sample = {
  t: 0,
  distance: 0,
  speed: 100,
  throttle: 100,
  brake: 0,
  gear: 3,
  rpm: 9000,
  drs: 8,
  x: 0,
  y: 0,
  latG: 0,
  longG: 0,
  downforce: 1000,
  loads: [100, 100, 100, 100],
  brakeTemp: [300, 300, 300, 300],
};
const last: Sample = {
  ...first,
  t: 1,
  speed: 200,
  brake: 1,
  gear: 4,
  drs: 12,
  brakeTemp: [500, 500, 500, 500],
};

test("interpolates continuous channels but holds discrete inputs", () => {
  const result = sampleAt([first, last], 0.5);
  assert.equal(result.speed, 150);
  assert.equal(result.gear, 3);
  assert.equal(result.brake, 0);
  assert.equal(result.drs, 8);
  assert.equal(result.brakeTemp[0], 400);
});

test("clamps both ends and selects exact sample boundaries", () => {
  assert.equal(sampleAt([first, last], -10).t, 0);
  assert.equal(sampleAt([first, last], 100).speed, 200);
  assert.equal(sampleAt([first, last], 1).gear, 4);
  assert.throws(() => sampleAt([], 0));
});

test("formats lap timing with millisecond precision and carry", () => {
  assert.equal(formatTime(70.123), "1:10.123");
  assert.equal(formatTime(59.9999), "1:00.000");
  assert.equal(formatTime(0), "0:00.000");
});

test("rejects missing or fabricated data instead of silently displaying it", () => {
  assert.throws(() => validateLap({}));
  assert.throws(() =>
    validateLap({ schemaVersion: 1, synthetic: true, source: "FastF1" }),
  );
});

test("lap peak is saturated red without changing the recorded temperature", () => {
  const samples = [first, last];
  const before = JSON.stringify(samples);
  const range = summarizeLayer(samples, "brakes");
  assert.deepEqual(range, {
    min: 300,
    max: 500,
    peakTime: 1,
    wheelPeaks: [500, 500, 500, 500],
  });
  assert.equal(heatIntensity(layerValue(last, "brakes"), range), 1);
  assert.equal(heatColorHex(1), "#ff160a");
  assert.equal(heatColorHex(0), "#00bfff");
  assert.equal(JSON.stringify(samples), before);
});

test("shared wheel scale preserves front/rear differences and clamps safely", () => {
  const range = summarizeLayer(
    [{ ...first, brakeTemp: [200, 300, 400, 500] }, last],
    "brakes",
  );
  assert.equal(heatIntensity(200, range), 0);
  assert.equal(heatIntensity(350, range), 0.5);
  assert.equal(heatIntensity(900, range), 1);
  assert.equal(heatIntensity(20, { min: 20, max: 20 }), 0);
  assert.throws(() => summarizeLayer([], "brakes"));
  assert.equal(
    layerValue({ ...first, loads: [100, 800, 500, 300] }, "loads"),
    800,
  );
});

const exportedLap = () =>
  JSON.parse(
    readFileSync(new URL("../public/lap.json", import.meta.url), "utf8"),
  );

test("the bundled real lap validates and every playback sample stays finite", () => {
  const lap = validateLap(exportedLap());
  assert.equal(lap.session.year, 2026);
  assert.equal(lap.session.event, "Monaco Grand Prix");
  assert.equal(lap.synthetic, false);
  assert.ok(
    Math.abs(
      lap.session.sectors.reduce((a, b) => a + b, 0) - lap.session.lapTime,
    ) < 0.001,
  );
  for (let time = 0; time <= lap.session.lapTime; time += 0.033) {
    const sample = sampleAt(lap.samples, time);
    assert.ok(Number.isFinite(sample.speed));
    assert.ok(sample.loads.every(Number.isFinite));
    assert.ok(sample.brakeTemp.every(Number.isFinite));
    assert.ok(
      Math.abs(
        sample.loads.reduce((a, b) => a + b, 0) -
          (Number(lap.model.massKg) * 9.80665 + sample.downforce),
      ) < 3,
    );
  }
});

const exportedCatalog = () =>
  JSON.parse(
    readFileSync(new URL("../public/catalog.json", import.meta.url), "utf8"),
  );

test("catalog validates all twelve real lap assets and selected identities", () => {
  const catalog = validateCatalog(exportedCatalog());
  assert.deepEqual(
    catalog.circuits.map((circuit) => circuit.id),
    ["monaco", "monza", "suzuka"],
  );
  for (const circuit of catalog.circuits) {
    assert.equal(circuit.drivers.length, 4);
    assert.equal(new Set(circuit.drivers.map((driver) => driver.team)).size, 4);
    for (const driver of circuit.drivers) {
      const lap = validateLap(
        JSON.parse(
          readFileSync(
            new URL(`../public/${driver.path}`, import.meta.url),
            "utf8",
          ),
        ),
      );
      assert.equal(lap.session.driver, driver.id);
      assert.equal(lap.session.driverName, driver.name);
      assert.equal(lap.session.team, driver.team);
      assert.equal(lap.session.teamColor, driver.color);
      assert.equal(lap.session.year, circuit.year);
      assert.equal(lap.session.lapTime, driver.lapTime);
      assert.ok(Number(lap.quality?.longestUnchangedCarChannelsS) < 5);
      for (const sample of lap.samples)
        assert.ok(
          Math.abs(
            sample.loads.reduce((a, b) => a + b, 0) -
              (Number(lap.model.massKg) * 9.80665 + sample.downforce),
          ) < 3,
        );
    }
  }
  assert.ok(
    catalog.circuits[2].selectionNotes?.some((note) =>
      note.includes("George Russell"),
    ),
  );
});

test("catalog rejects unsafe paths, duplicate identities, colours and ordering", () => {
  for (const mutate of [
    (catalog: ReturnType<typeof exportedCatalog>) => {
      catalog.circuits[0].drivers[0].path = "../lap.json";
    },
    (catalog: ReturnType<typeof exportedCatalog>) => {
      catalog.circuits[0].drivers[0].color = "red";
    },
    (catalog: ReturnType<typeof exportedCatalog>) => {
      catalog.circuits[1].id = "monaco";
    },
    (catalog: ReturnType<typeof exportedCatalog>) => {
      catalog.circuits[0].drivers[1] = catalog.circuits[0].drivers[0];
    },
    (catalog: ReturnType<typeof exportedCatalog>) => {
      catalog.circuits[0].drivers.reverse();
    },
    (catalog: ReturnType<typeof exportedCatalog>) => {
      catalog.defaultCircuit = "missing";
    },
  ]) {
    const catalog = exportedCatalog();
    mutate(catalog);
    assert.throws(() => validateCatalog(catalog));
  }
});

test("lap validation rejects impossible inputs and inconsistent metadata", () => {
  for (const mutate of [
    (lap: ReturnType<typeof exportedLap>) => {
      lap.samples[3].brake = 2;
    },
    (lap: ReturnType<typeof exportedLap>) => {
      lap.samples[3].loads[0] = -1;
    },
    (lap: ReturnType<typeof exportedLap>) => {
      lap.samples[3].distance = -1;
    },
    (lap: ReturnType<typeof exportedLap>) => {
      lap.samples[3].throttle = 104;
    },
    (lap: ReturnType<typeof exportedLap>) => {
      lap.session.sectors[0] += 1;
    },
    (lap: ReturnType<typeof exportedLap>) => {
      lap.session.airTemp = "warm";
    },
    (lap: ReturnType<typeof exportedLap>) => {
      lap.corners[0].distance = NaN;
    },
  ]) {
    const lap = exportedLap();
    mutate(lap);
    assert.throws(() => validateLap(lap));
  }
});

test("rejects non-finite channels, unsorted timestamps and incomplete laps", () => {
  const invalid = exportedLap();
  invalid.samples[10].speed = NaN;
  assert.throws(() => validateLap(invalid), /Invalid telemetry/);
  const unsorted = exportedLap();
  unsorted.samples[10].t = unsorted.samples[9].t;
  assert.throws(() => validateLap(unsorted), /Invalid telemetry/);
  const incomplete = exportedLap();
  incomplete.samples.pop();
  assert.throws(() => validateLap(incomplete), /complete lap/);
});
