import { test, expect } from "@playwright/test";
import {
  formatTime,
  summarizeLayer,
  validateLap,
  validateCatalog,
} from "../src/telemetry.ts";

test("real session, 3D, playback, seeking, layers and model notes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#driver-name")).toHaveText("Kimi Antonelli");
  await expect(page.locator("#lap-time")).toHaveText("1:12.051");
  await expect(page.locator("#car-canvas canvas")).toBeVisible();
  await expect(page.locator(".webgl-error")).toHaveCount(0);
  await expect(page.locator("#speed")).not.toHaveText("—");
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Play lap", exact: true }).click();
  await expect(page.locator("#current-time")).not.toHaveText("0:00.000");
  await page.getByRole("button", { name: "Pause lap", exact: true }).click();
  await expect(page.locator("#playback-state")).toHaveText("PAUSED");
  await page.locator("#scrubber").fill("30");
  await expect(page.locator("#current-time")).toHaveText("0:30.000");
  await expect(page.locator("#sector-badge")).toHaveText("S2");
  const initialMeasure = await page.locator("#measure-value").textContent();
  await page.locator('[data-layer="loads"]').click();
  await expect(page.locator("#measure-label")).toHaveText(
    "HEAVIEST WHEEL LOAD",
  );
  await expect(page.locator("#measure-unit")).toHaveText("kN");
  await expect(page.locator("#measure-value")).not.toHaveText(initialMeasure!);
  await page.locator('[data-layer="aero"]').click();
  await expect(page.locator("#wheel-readouts")).toBeHidden();
  await page.locator('[data-layer="clean"]').click();
  await expect(page.locator("#heat-legend")).toBeHidden();
  await page.locator('[data-layer="brakes"]').click();
  await expect(page.locator("#heat-legend")).toBeVisible();
  await page.locator('[data-camera="top"]').click();
  await expect(page.locator('[data-camera="top"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#reset-view").click();
  await expect(page.locator('[data-camera="orbit"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Jump to sector 3" }).click();
  await expect(page.locator("#current-time")).toHaveText("0:52.923");
  await page.locator("#methodology").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#dialog-source")).toContainText("FastF1");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.locator("#scrubber").fill("72.051");
  await expect(page.locator("#playback-state")).toHaveText("LAP COMPLETE");
  await page.locator("#scrubber").fill("30");
  await expect(page.locator("#playback-state")).toHaveText("PAUSED");
  await page.locator("#scrubber").fill("72.051");
  await page.getByRole("button", { name: "Play lap", exact: true }).click();
  await expect(page.locator("#current-time")).not.toHaveText("1:12.051");
  await page.getByRole("button", { name: "Pause lap", exact: true }).click();
  expect(errors).toEqual([]);
});

test("mobile layout has no horizontal overflow and keeps controls usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#driver-name")).toHaveText("Kimi Antonelli");
  await page.locator("#scrubber").fill("35");
  await expect(page.locator("#current-time")).toHaveText("0:35.000");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});

test("missing data is explicit and does not fabricate telemetry", async ({
  page,
}) => {
  await page.route("**/laps/2026-monaco-ant.json", (route) =>
    route.fulfill({ status: 404, body: "Not found" }),
  );
  await page.goto("/");
  await expect(page.locator("#data-status")).toContainText(
    "No simulated telemetry",
  );
  await expect(page.locator("#play")).toBeDisabled();
  await expect(page.locator("#speed")).toHaveText("—");
});

test("heat peaks are red and the map, timeline and wheel gauges follow the layer", async ({
  page,
  request,
}) => {
  const lap = validateLap(await (await request.get("/lap.json")).json());
  const brakePeak = summarizeLayer(lap.samples, "brakes");
  await page.goto("/");
  await expect(page.locator("#jump-peak")).toBeEnabled();
  await page.getByRole("button", { name: "Jump to hottest disc peak" }).click();
  await expect(page.locator("#current-time")).toHaveText(
    formatTime(brakePeak.peakTime),
  );
  await expect(page.locator("#measure-value")).toHaveText(
    brakePeak.max.toFixed(1),
  );
  await expect(page.locator("#measure-value")).toHaveCSS(
    "color",
    "rgb(255, 22, 10)",
  );
  await expect(page.locator("#intensity-state")).toHaveText(
    "100% OF LAP RANGE · PEAK",
  );
  await expect(page.locator("#legend-caption")).toContainText("RELATIVE SCALE");
  await expect(page.locator("#track")).toHaveAttribute(
    "aria-label",
    /hottest disc/,
  );
  await expect(page.locator("#trace-channel")).toHaveText(
    "HOTTEST DISC · EST.",
  );
  expect(
    await page.locator("#wheel-fill-FL").evaluate((el) => el.style.width),
  ).toBe("100%");
  await page.screenshot({
    path: "test-results/brake-peak.png",
    fullPage: true,
  });
  await page.locator("[data-layer=loads]").click();
  await page
    .getByRole("button", { name: "Jump to heaviest wheel peak" })
    .click();
  await expect(page.locator("#trace-channel")).toHaveText(
    "HEAVIEST WHEEL · EST.",
  );
  await expect(page.locator("#intensity-state")).toContainText("100%");
  await expect(page.locator("#track")).toHaveAttribute(
    "aria-label",
    /heaviest wheel/,
  );
  await page.screenshot({ path: "test-results/load-peak.png", fullPage: true });
  await page.locator("[data-layer=aero]").click();
  await page.getByRole("button", { name: "Jump to downforce peak" }).click();
  await expect(page.locator("#trace-channel")).toHaveText("DOWNFORCE · EST.");
  await expect(page.locator("#measure-value")).toHaveCSS(
    "color",
    "rgb(255, 22, 10)",
  );
  await page.screenshot({ path: "test-results/aero-peak.png", fullPage: true });
  await page.locator("[data-layer=clean]").click();
  await expect(page.locator("#trace-channel")).toHaveText("SPEED");
});

test("all circuits and drivers load matching telemetry and team paint", async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  const catalog = validateCatalog(
    await (await request.get("/catalog.json")).json(),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#play")).toBeEnabled();
  for (const circuit of catalog.circuits) {
    await page.selectOption("#circuit-select", circuit.id);
    for (const driver of circuit.drivers) {
      await page.selectOption("#driver-select", driver.id);
      await expect(page.locator("#lap-time")).toHaveText(
        formatTime(driver.lapTime),
      );
      await expect(page.locator("#driver-name")).toHaveText(driver.name);
      await expect(page.locator("#team")).toHaveText(driver.team);
      await expect(page.locator("#car-canvas")).toHaveAttribute(
        "data-team-color",
        driver.color,
      );
      await expect(page.locator("#playback-state")).toHaveText("PAUSED");
      await expect(page.locator("#current-time")).toHaveText("0:00.000");
      await expect(page.locator("#circuit-name")).toHaveText(circuit.name);
      await page.locator("[data-layer=loads]").click();
      await page.locator("#jump-peak").click();
      await expect(page.locator("#intensity-state")).toContainText("100%");
    }
    await page.locator("[data-layer=clean]").click();
    await page.screenshot({
      path: `test-results/${circuit.id}-team.png`,
      fullPage: true,
    });
  }
  await expect(page.locator("#selection-notes")).toContainText(
    "George Russell",
  );
  await page.locator("[data-layer=brakes]").click();
  await expect(page.locator("#peak-note")).toBeVisible();
  expect(errors).toEqual([]);
});

test("failed selection clears the prior lap and retry recovers", async ({
  page,
  request,
}) => {
  const catalog = validateCatalog(
    await (await request.get("/catalog.json")).json(),
  );
  const driver = catalog.circuits[0].drivers[1];
  const pattern = `**/${driver.path}`;
  await page.goto("/");
  await expect(page.locator("#play")).toBeEnabled();
  await page.locator("#scrubber").fill("25");
  await page.route(pattern, (route) =>
    route.fulfill({ status: 404, body: "Missing" }),
  );
  await page.selectOption("#driver-select", driver.id);
  await expect(page.locator("#data-status")).toContainText(
    "No simulated telemetry",
  );
  for (const id of [
    "speed",
    "rpm",
    "measure-value",
    "lap-time",
    "wheel-FL",
    "dialog-source",
  ])
    await expect(page.locator(`#${id}`)).toHaveText("—");
  await expect(page.locator("#play")).toBeDisabled();
  await expect(page.locator("#jump-peak")).toBeDisabled();
  await expect(page.locator("#car-canvas")).not.toHaveAttribute(
    "data-team-color",
  );
  await page.unroute(pattern);
  await page.locator("#retry-load").click();
  await expect(page.locator("#lap-time")).toHaveText(
    formatTime(driver.lapTime),
  );
  await expect(page.locator("#play")).toBeEnabled();
});

test("late responses cannot overwrite a newer driver selection", async ({
  page,
  request,
}) => {
  const catalog = validateCatalog(
    await (await request.get("/catalog.json")).json(),
  );
  const [, delayed, newest] = catalog.circuits[0].drivers;
  const body = await (await request.get(`/${delayed.path}`)).text();
  let release: (() => void) | undefined;
  await page.route(`**/${delayed.path}`, async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route
      .fulfill({ status: 200, contentType: "application/json", body })
      .catch(() => {});
  });
  await page.goto("/");
  await expect(page.locator("#play")).toBeEnabled();
  await page.selectOption("#driver-select", delayed.id);
  await expect.poll(() => !!release).toBe(true);
  await page.selectOption("#driver-select", newest.id);
  await expect(page.locator("#lap-time")).toHaveText(
    formatTime(newest.lapTime),
  );
  release!();
  await page.waitForTimeout(300);
  await expect(page.locator("#driver-name")).toHaveText(newest.name);
  await expect(page.locator("#car-canvas")).toHaveAttribute(
    "data-team-color",
    newest.color,
  );
});

test("catalog and mismatched lap failures remain explicit", async ({
  page,
  request,
}) => {
  await page.route("**/catalog.json", (route) =>
    route.fulfill({ status: 404, body: "Missing" }),
  );
  await page.goto("/");
  await expect(page.locator("#play")).toBeDisabled();
  await expect(page.locator("#data-status")).toContainText(
    "No simulated telemetry",
  );
  await page.unroute("**/catalog.json");
  const catalog = validateCatalog(
    await (await request.get("/catalog.json")).json(),
  );
  const other = catalog.circuits[0].drivers[1];
  const wrong = await (await request.get(`/${other.path}`)).text();
  await page.route(`**/${catalog.circuits[0].drivers[0].path}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: wrong,
    }),
  );
  await page.locator("#retry-load").click();
  await expect(page.locator("#data-status")).toContainText(
    "No simulated telemetry",
  );
  await expect(page.locator("#speed")).toHaveText("—");
});

test("mobile selection, driver cards and corner seeking remain usable", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const catalog = validateCatalog(
    await (await request.get("/catalog.json")).json(),
  );
  const circuit = catalog.circuits[2],
    driver = circuit.drivers[1];
  const lap = validateLap(await (await request.get(`/${driver.path}`)).json());
  await page.goto("/");
  await expect(page.locator("#play")).toBeEnabled();
  await page.selectOption("#circuit-select", circuit.id);
  await page.locator(`[data-driver=${driver.id}]`).click();
  await expect(page.locator("#lap-time")).toHaveText(
    formatTime(driver.lapTime),
  );
  await expect(page.locator("#peak-note")).toBeVisible();
  const corner = lap.corners[2];
  const nearest = lap.samples.reduce((best, point) =>
    Math.abs(point.distance - corner.distance) <
    Math.abs(best.distance - corner.distance)
      ? point
      : best,
  );
  await page.selectOption("#corner-select", String(corner.distance));
  await expect(page.locator("#current-time")).toHaveText(formatTime(nearest.t));
  await expect(page.locator("#playback-state")).toHaveText("PAUSED");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-suzuka.png",
    fullPage: true,
  });
});

test("persistent transport and trace inspection stay synchronised", async ({
  page,
}) => {
  await page.goto("/");
  const dock = page.locator("#dock-scrubber");
  await expect(dock).toBeEnabled();
  await dock.fill("25");
  await expect(page.locator("#scrubber")).toHaveValue("25");
  await expect(page.locator("#current-time")).toHaveText("0:25.000");
  const plot = page.locator("#scrubber");
  await plot.hover({ position: { x: 120, y: 30 } });
  await expect(page.locator("#trace-inspection")).toBeVisible();
  await expect(page.locator("#inspect-value")).toContainText("°C");
  await expect(page.locator("#current-time")).toHaveText("0:25.000");
  await page.locator("[data-layer=clean]").click();
  await expect(page.locator("#trace-inspection")).toBeHidden();
  await plot.hover({ position: { x: 120, y: 30 } });
  await expect(page.locator("#inspect-value")).toContainText("km/h");
  await dock.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#current-time")).toHaveText("0:25.001");
  await dock.fill((await dock.getAttribute("max"))!);
  await expect(page.locator("#playback-state")).toHaveText("LAP COMPLETE");
  await page.locator("#methodology").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#methodology")).toBeFocused();
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(page.locator("#play")).toBeInViewport();
});

test("reduced motion cancels decoration without delaying data or focus", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#play")).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await page.locator("[data-layer=loads]").click();
  await page.locator("#jump-peak").click();
  await expect(page.locator("#intensity-state")).toContainText("100%");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((a) => a.playState === "running")
            .length,
      ),
    )
    .toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "false",
  );
  await page.locator("#methodology").click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((a) => a.playState === "running")
            .length,
      ),
    )
    .toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#methodology")).toBeFocused();
});

test("console reflows with readable controls and unobstructed transport", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#play")).toBeEnabled();
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [768, 1024],
    [640, 450],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await expect(page.locator("#play")).toBeInViewport();
    await expect(page.locator("#dock-scrubber")).toBeInViewport();
    expect(
      await page
        .locator("#play")
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
    await page.locator("#corner-select").scrollIntoViewIfNeeded();
    const corner = await page.locator("#corner-select").boundingBox();
    const dock = await page.locator("#transport").boundingBox();
    expect(corner!.y + corner!.height).toBeLessThanOrEqual(dock!.y);
  }
});

test("telemetry and playback remain usable without WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: function (
        this: HTMLCanvasElement,
        kind: string,
        options?: unknown,
      ) {
        if (
          kind === "webgl" ||
          kind === "webgl2" ||
          kind === "experimental-webgl"
        )
          return null;
        return getContext.call(this, kind as "2d", options);
      },
    });
  });
  await page.goto("/");
  await expect(page.locator(".webgl-error")).toBeVisible();
  await expect(page.locator("#driver-name")).toHaveText("Kimi Antonelli");
  await expect(page.locator("#play")).toBeEnabled();
  await page.selectOption("#circuit-select", "monza");
  await expect(page.locator("#lap-time")).toHaveText("1:21.786");
  await page.selectOption("#driver-select", "LEC");
  await expect(page.locator("#lap-time")).toHaveText("1:22.004");
  await page.getByRole("button", { name: "Play lap", exact: true }).click();
  await expect(page.locator("#current-time")).not.toHaveText("0:00.000");
  await expect(page.locator("#speed")).not.toHaveText("—");
});
