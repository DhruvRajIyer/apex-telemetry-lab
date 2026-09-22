import argparse
import json
import re
from pathlib import Path

import fastf1
import numpy as np
import pandas as pd


G = 9.80665
MASS = 800
CIRCUITS = [
    {"id": "monaco", "name": "Monaco", "event": "Monaco", "circuitName": "Circuit de Monaco", "character": "Tight streets · low-speed traction · repeated braking"},
    {"id": "monza", "name": "Monza", "event": "Italian", "circuitName": "Autodromo Nazionale Monza", "character": "Long straights · high speed · heavy chicane braking"},
    {"id": "suzuka", "name": "Suzuka", "event": "Japanese", "circuitName": "Suzuka International Racing Course", "character": "Fast esses · sustained lateral load · flowing corners"},
]


def smooth(values, width=9):
    return np.convolve(np.pad(values, width // 2, mode="edge"), np.ones(width) / width, mode="valid")


def resample_channel(source_time, values, target, discrete=False):
    source_time, values, target = [np.asarray(value, dtype=float) for value in (source_time, values, target)]
    if (len(source_time) < 2 or len(source_time) != len(values)
            or not all(np.isfinite(value).all() for value in (source_time, values, target))
            or np.any(np.diff(source_time) <= 0) or np.max(np.diff(source_time)) > 2
            or np.min(target) < source_time[0] or np.max(target) > source_time[-1]):
        raise ValueError("Invalid, gapped, or incomplete native telemetry; no extrapolation or synthetic fallback.")
    if discrete:
        if not np.equal(values, np.floor(values)).all():
            raise ValueError("Discrete telemetry contains non-integral values.")
        return values[np.searchsorted(source_time, target, side="right") - 1].astype(int)
    return np.interp(target, source_time, values)


def estimate_motion(t, velocity, x, y):
    dt = float(t[1] - t[0])
    if not np.allclose(np.diff(t), dt):
        raise ValueError("Motion estimates require a uniform time grid.")
    velocity = smooth(velocity)
    sx, sy = smooth(x, 15), smooth(y, 15)
    dx, dy = np.gradient(sx, dt), np.gradient(sy, dt)
    ddx, ddy = np.gradient(dx, dt), np.gradient(dy, dt)
    curvature = (dx * ddy - dy * ddx) / np.maximum((dx * dx + dy * dy) ** 1.5, 1)
    raw_lateral = smooth(curvature * velocity ** 2 / G, 15)
    raw_acceleration = smooth(np.gradient(velocity, dt))
    return np.clip(raw_lateral, -6, 6), np.clip(raw_acceleration, -60, 30) / G, {
        "lateralClippedSamples": int(np.count_nonzero(np.abs(raw_lateral) > 6)),
        "longitudinalClippedSamples": int(np.count_nonzero((raw_acceleration < -60) | (raw_acceleration > 30))),
    }


def wheel_loads(lateral_g, longitudinal_g, downforce, mass=MASS, wheelbase=3.4, track=1.6, cg_height=0.3):
    vertical = mass * G + downforce
    front = np.clip(vertical * 0.46 - mass * longitudinal_g * G * cg_height / wheelbase, 0, vertical)
    transfer = mass * lateral_g * G * cg_height / track
    front_shift = np.clip(transfer / 2, -front / 2, front / 2)
    rear_shift = np.clip(transfer / 2, -(vertical - front) / 2, (vertical - front) / 2)
    return [front / 2 - front_shift, front / 2 + front_shift,
            (vertical - front) / 2 - rear_shift, (vertical - front) / 2 + rear_shift]


def brake_model(t, velocity, brake, ambient, mass=MASS, drag_cda=1.2):
    temperatures = np.full((len(t), 4), 350.0)
    energy = np.zeros(len(t))
    for i in range(1, len(t)):
        dt = t[i] - t[i - 1]
        if dt <= 0:
            raise ValueError("Brake model timestamps must increase.")
        speed = (velocity[i - 1] + velocity[i]) / 2
        kinetic_loss = 0.5 * mass * (velocity[i - 1] ** 2 - velocity[i] ** 2)
        drag_power = 0.5 * 1.225 * drag_cda * speed ** 3
        power = max(0, kinetic_loss / dt - drag_power) * brake[i - 1]
        energy[i] = energy[i - 1] + power * dt
        heating = power * np.array([0.3, 0.3, 0.2, 0.2]) * 0.9
        cooling = 35 + 1.1 * speed
        decay = np.exp(-cooling * dt / 2000)
        temperatures[i] = ambient + (temperatures[i - 1] - ambient) * decay + heating / cooling * (-np.expm1(-cooling * dt / 2000))
    return temperatures, energy


def select_team_laps(laps):
    candidates = laps.loc[(laps["IsPersonalBest"] == True) & laps["LapTime"].notna()]
    return candidates.sort_values("LapTime", kind="stable").drop_duplicates("Team").head(4)


def load_session(year, event):
    cache = Path(__file__).parent / ".fastf1-cache"
    cache.mkdir(exist_ok=True)
    fastf1.Cache.enable_cache(str(cache))
    session = fastf1.get_session(year, event, "Q")
    session.load(telemetry=True, weather=True, messages=True)
    return session


def longest_unchanged_span(times, values, duration):
    longest, start = 0.0, 0
    for i in range(1, len(times) + 1):
        if i == len(times) or not np.array_equal(values[i], values[i - 1]):
            longest = max(longest, min(float(times[i - 1]), duration) - max(float(times[start]), 0))
            start = i
    return longest


def corner_distance(x, y, distance, marker_x, marker_y):
    index = int(np.argmin((np.asarray(x) - marker_x) ** 2 + (np.asarray(y) - marker_y) ** 2))
    return float(distance[index])


def native_data(lap, kind):
    data = (lap.get_car_data(pad=10) if kind == "car" else lap.get_pos_data(pad=10))
    data = data.loc[data["Source"] == kind].sort_values("Time").drop_duplicates("Time")
    if len(data) < 20:
        raise ValueError(f"Insufficient native {kind} telemetry.")
    return data, data["Time"].dt.total_seconds().to_numpy()


def build_lap(session, lap):
    if lap is None or pd.isna(lap["LapTime"]):
        raise RuntimeError("No valid fastest qualifying lap is available.")
    duration = lap["LapTime"].total_seconds()
    sectors = [lap[f"Sector{i}Time"].total_seconds() for i in (1, 2, 3)]
    if not np.isfinite(duration) or duration <= 0 or not all(np.isfinite(sectors)) or min(sectors) <= 0 or abs(sum(sectors) - duration) > 0.01:
        raise ValueError("Invalid or inconsistent lap and sector timing.")
    car, car_t = native_data(lap, "car")
    unchanged = longest_unchanged_span(car_t, car[["Speed", "Throttle", "Brake", "nGear", "RPM"]].to_numpy(), duration)
    if unchanged >= 5:
        raise ValueError(f"Source car channels unchanged for {unchanged:.1f}s (5s quality gate); estimates would be unreliable.")
    pos, pos_t = native_data(lap, "pos")
    t = np.append(np.arange(0, duration, 0.1), duration)
    speed = resample_channel(car_t, car["Speed"], t)
    x = resample_channel(pos_t, pos["X"], t) / 10
    y = resample_channel(pos_t, pos["Y"], t) / 10
    brake = resample_channel(car_t, car["Brake"], t, discrete=True)
    throttle_raw = resample_channel(car_t, car["Throttle"], t)
    throttle = np.clip(throttle_raw, 0, 100)
    gear = resample_channel(car_t, car["nGear"], t, discrete=True)
    rpm = resample_channel(car_t, car["RPM"], t)
    drs = resample_channel(car_t, car["DRS"], t, discrete=True)
    if (np.any(speed < 0) or np.any((throttle < 0) | (throttle > 100))
            or np.any((gear < 0) | (gear > 8)) or not np.isin(brake, [0, 1]).all() or np.any(rpm < 0)):
        raise ValueError("Native telemetry contains out-of-range channels.")
    grid_start = np.ceil(max(car_t[0], pos_t[0]) * 10) / 10
    grid_end = np.floor(min(car_t[-1], pos_t[-1]) * 10) / 10
    grid = np.arange(round(grid_start * 10), round(grid_end * 10) + 1) / 10
    if len(grid) < 30 or grid[0] > 0 or grid[-1] < duration:
        raise ValueError("Insufficient padded data for uniform-grid derivatives.")
    velocity = resample_channel(car_t, car["Speed"], grid) / 3.6
    gx = resample_channel(pos_t, pos["X"], grid) / 10
    gy = resample_channel(pos_t, pos["Y"], grid) / 10
    lateral, longitudinal, quality = estimate_motion(grid, velocity, gx, gy)
    lateral, longitudinal = np.interp(t, grid, lateral), np.interp(t, grid, longitudinal)
    downforce = 0.5 * 1.225 * 3.5 * (speed / 3.6) ** 2
    loads = [wheel_loads(lat, lon, aero) for lat, lon, aero in zip(lateral, longitudinal, downforce)]
    weather = lap.get_weather_data()
    air_temp = float(weather["AirTemp"]) if pd.notna(weather.get("AirTemp")) else None
    track_temp = float(weather["TrackTemp"]) if pd.notna(weather.get("TrackTemp")) else None
    ambient = air_temp if air_temp is not None else 25
    temperatures, energy = brake_model(t, speed / 3.6, brake, ambient)
    distance = np.concatenate(([0], np.cumsum((speed[:-1] + speed[1:]) / 7.2 * np.diff(t))))
    driver = session.get_driver(lap["Driver"])
    color = str(driver["TeamColor"]).lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", color):
        raise ValueError("Missing FastF1 team colour; cannot export driver identity.")
    corners = []
    try:
        info = session.get_circuit_info()
        corners = [{"number": int(row.Number), "letter": str(row.Letter),
                    "distance": round(corner_distance(x, y, distance, row.X / 10, row.Y / 10), 2)}
                   for row in info.corners.itertuples() if np.isfinite([row.X, row.Y]).all()]
    except (ValueError, RuntimeError, KeyError, AttributeError):
        pass
    quality.update({"longestUnchangedCarChannelsS": round(unchanged, 3), "unchangedChannelGateS": 5,
                    "throttleSourceMin": float(car["Throttle"].min()), "throttleSourceMax": float(car["Throttle"].max()),
                    "throttleClampedPlaybackSamples": int(np.count_nonzero(throttle != throttle_raw)),
                    "throttleCorrection": "Playback throttle bounded to 0–100%; source extrema include padding.",
                    "cornerMethod": "MultiViewer markers via FastF1 projected onto the selected lap's XY samples, not another driver's integrated distance.",
                    "carSamples": len(car_t), "positionSamples": len(pos_t),
                    "carMaxGapS": float(np.max(np.diff(car_t))), "positionMaxGapS": float(np.max(np.diff(pos_t))),
                    "derivativePaddingBeforeS": float(-grid[0]), "derivativePaddingAfterS": float(grid[-1] - duration),
                    "clippingScope": "Padded uniform derivative grid, including points outside the displayed lap"})
    result = {
        "schemaVersion": 1, "source": "FastF1", "synthetic": False,
        "session": {"year": int(session.event.year), "event": str(session.event["EventName"]), "name": "Qualifying",
                    "driver": str(lap["Driver"]), "driverName": str(driver["FullName"]),
                    "team": str(lap["Team"]), "teamColor": "#" + color.lower(),
                    "lapNumber": int(lap["LapNumber"]), "lapTime": duration,
                    "compound": str(lap["Compound"]), "tyreLife": float(lap["TyreLife"]),
                    "sectors": sectors, "airTemp": air_temp, "trackTemp": track_temp},
        "model": {"version": 2,
                  "description": "Uncalibrated illustrative scenarios, not measured vehicle performance. Identical generic parameters for all teams and circuits; not actual 2026 car specifications.",
                  "massKg": MASS, "aeroClA": 3.5, "dragCdA": 1.2, "airDensity": 1.225,
                  "wheelbaseM": 3.4, "trackM": 1.6, "cgHeightM": 0.3,
                  "staticFrontFraction": 0.46, "aeroFrontFraction": 0.46, "lateralTransferFrontFraction": 0.5,
                  "brakeFrontFraction": 0.6, "rotorInitialC": 350, "rotorHeatCapacityJPerK": 2000,
                  "rotorHeatFraction": 0.9, "ambientC": ambient, "ambientSource": "lap weather" if air_temp is not None else "assumed fallback",
                  "coolingWattsPerK": "35 + 1.1 × speed(m/s)", "wheelOrder": ["FL", "FR", "RL", "RR"],
                  "motionMethod": "Native channels linearly aligned once to a padded 0.1 s grid; 0.9 s speed/acceleration and 1.5 s XY/lateral moving averages. Derivative estimates interpolated to playback endpoints.",
                  "lateralLimitG": 6, "longitudinalLimitsMps2": [-60, 30],
                  "brakeMethod": "Interval kinetic-energy loss minus assumed aerodynamic drag, gated by previous-sample brake state; exact constant-input thermal step. No regenerative/engine braking, grade, wind, tyre slip or actual brake balance.",
                  "residualBrakingEnergyKJ": round(float(energy[-1] / 1000), 2),
                  "limitations": "Position noise and smoothing attenuate corner peaks. No banking/elevation, suspension dynamics, active aero or circuit-specific setup. Aero colours are not a pressure map. Rotor initial state is unknown; left/right brake temperatures are identical by construction."},
        "quality": quality,
        "sampling": "Original FastF1 car and position channels aligned directly to a 10 Hz playback grid: linear continuous channels, previous-value discrete channels. Not native 10 Hz measurements. Throttle is bounded to 0–100%; original range and adjustment count are recorded in quality metadata. Distance is trapezoidal integration of speed, not surveyed track length.",
        "corners": corners, "samples": []}
    for i in range(len(t)):
        result["samples"].append({"t": round(float(t[i]), 4), "distance": round(float(distance[i]), 2),
                                  "speed": round(float(speed[i]), 2), "throttle": round(float(throttle[i]), 1),
                                  "brake": int(brake[i]), "gear": int(gear[i]), "rpm": round(float(rpm[i])), "drs": int(drs[i]),
                                  "x": round(float(x[i]), 3), "y": round(float(y[i]), 3),
                                  "latG": round(float(lateral[i]), 3), "longG": round(float(longitudinal[i]), 3),
                                  "downforce": round(float(downforce[i])),
                                  "loads": [round(v) for v in loads[i]], "brakeTemp": [round(v, 1) for v in temperatures[i]]})
    json.dumps(result, allow_nan=False)
    return result


def write_json(output, result):
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n")


def extract(year, event, output, driver=None):
    session = load_session(year, event)
    laps = session.laps.pick_not_deleted()
    lap = (laps.pick_drivers(driver) if driver else laps).pick_fastest()
    result = build_lap(session, lap)
    write_json(output, result)
    print(f"Exported {year} {event} Q · {lap['Driver']} · {result['session']['lapTime']:.3f}s → {output}")


def extract_catalog(year, root):
    catalog = {"schemaVersion": 1, "defaultCircuit": "monaco", "circuits": []}
    exports = []
    for spec in CIRCUITS:
        session = load_session(year, spec["event"])
        laps = select_team_laps(session.laps.pick_not_deleted())
        if len(laps) != 4:
            raise RuntimeError(f"Four teams with valid qualifying laps unavailable for {year} {spec['name']}.")
        circuit = {**spec, "year": year, "drivers": [], "selectionNotes": []}
        for index in laps.index:
            reference = session.laps.loc[index]
            available = session.laps.pick_not_deleted().pick_accurate().pick_wo_box().pick_teams(reference["Team"])
            available = available.loc[available["LapTime"] >= reference["LapTime"]].sort_values("LapTime", kind="stable")
            result = None
            rejected = []
            for candidate_index in available.index:
                candidate = session.laps.loc[candidate_index]
                try:
                    result = build_lap(session, candidate)
                    break
                except (ValueError, RuntimeError) as error:
                    reason = f"{candidate['Driver']} lap {int(candidate['LapNumber'])}: {error}"
                    rejected.append(reason)
                    print(f"Excluded {spec['name']} {reason}", flush=True)
            if result is None:
                raise RuntimeError(f"No usable lap for {spec['name']} {reference['Team']}: {'; '.join(rejected)}")
            s = result["session"]
            if rejected or s["driver"] != reference["Driver"] or s["lapNumber"] != int(reference["LapNumber"]):
                circuit["selectionNotes"].append(f"{reference['Team']}: selected {s['driverName']} lap {s['lapNumber']} ({s['lapTime']:.3f}s) instead of the fastest team lap {reference['Driver']} ({reference['LapTime'].total_seconds():.3f}s). " + " ".join(rejected))
            result["selection"] = {"policy": "Fastest usable lap for each of the four quickest teams by official personal-best timing", "excludedCandidates": rejected}
            asset = f"laps/{year}-{spec['id']}-{s['driver'].lower()}.json"
            exports.append((root / asset, result))
            circuit["drivers"].append({"id": s["driver"], "name": s["driverName"], "team": s["team"],
                                       "color": s["teamColor"], "lapTime": s["lapTime"], "path": asset})
            print(f"Prepared {year} {spec['name']} · {s['driver']} · {s['team']} · {s['lapTime']:.3f}s", flush=True)
        circuit["drivers"].sort(key=lambda driver: driver["lapTime"])
        catalog["circuits"].append(circuit)
    for output, result in exports:
        write_json(output, result)
    default_path = root / catalog["circuits"][0]["drivers"][0]["path"]
    write_json(root / "lap.json", next(result for path, result in exports if path == default_path))
    write_json(root / "catalog.json", catalog)
    print(f"Published local catalog: {len(exports)} real laps across {len(CIRCUITS)} circuits.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("year", type=int)
    parser.add_argument("event", nargs="?", default="Monaco")
    parser.add_argument("output", type=Path, nargs="?", default=Path("public/lap.json"))
    parser.add_argument("--driver", help="Driver abbreviation; defaults to fastest overall valid lap")
    parser.add_argument("--catalog", action="store_true", help="Export four fastest distinct teams at Monaco, Monza and Suzuka")
    args = parser.parse_args()
    if args.catalog:
        extract_catalog(args.year, args.output.parent)
    else:
        extract(args.year, args.event, args.output, args.driver)
