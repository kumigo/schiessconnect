import test from "node:test";
import assert from "node:assert/strict";
import {
  orderCorners, homography, applyHomography, warpTarget, pxPerCmFor,
  detectHoles, findWhiteDot, computeCorrection, correctionLines, cmPerClick,
} from "../core.js";
import { makeTarget, makePhoto } from "./synth.mjs";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("Ecken werden in feste Reihenfolge gebracht", () => {
  const tl = [100, 120], tr = [900, 90], br = [950, 800], bl = [80, 760];
  assert.deepEqual(orderCorners([br, tl, bl, tr]), [tl, tr, br, bl]);
});

test("Homographie bildet die Ecken exakt ab", () => {
  const src = [[10, 20], [400, 5], [420, 380], [0, 400]];
  const dst = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const H = homography(src, dst);
  src.forEach((p, i) => {
    const [u, v] = applyHomography(H, ...p);
    near(u, dst[i][0], 1e-6, "u"); near(v, dst[i][1], 1e-6, "v");
  });
});

test("Klickrechnung wie in der Kamera-Version", () => {
  near(cmPerClick(100, "mrad", 0.1), 1.0, 1e-9, "0,1 mrad");
  near(cmPerClick(100, "moa", 0.25), 0.727, 1e-9, "1/4 MOA");
  near(cmPerClick(100, "cm", 1.3), 1.3, 1e-9, "Wärmebild-Vorsatz 1,3 cm / 100 m");
  near(cmPerClick(50, "cm", 1.3), 0.65, 1e-9, "auf 50 m halb so viel");
  // Treffer 3 cm rechts und 4 cm zu tief -> 4 hoch, 3 links.
  const c = computeCorrection({ x: 25, y: 25 }, [{ x: 28, y: 29 }], 100, "mrad", 0.1);
  assert.equal(c.clicksUp, 4);
  assert.equal(c.clicksLeft, 3);
  assert.deepEqual(correctionLines(c), ["4 Klicks HOCH", "3 Klicks LINKS"]);
  const d = computeCorrection({ x: 25, y: 25 }, [{ x: 22.5, y: 22.5 }], 100, "mrad", 0.1);
  assert.deepEqual(correctionLines(d), ["3 Klicks TIEF", "3 Klicks RECHTS"]);
  assert.equal(computeCorrection({ x: 0, y: 0 }, [], 100, "mrad", 0.1), null);
});

test("Schräges Foto: Löcher, weißer Punkt und Klicks werden gefunden", () => {
  const holes = [
    { x: 28.0, y: 29.0 }, // im Schwarzen
    { x: 30.5, y: 27.0 }, // im Schwarzen
    { x: 26.0, y: 31.5 }, // im Schwarzen
    { x: 37.0, y: 33.0 }, // auf weißem Papier
  ];
  const target = makeTarget({ holes });
  const corners = [[260, 140], [1330, 190], [1290, 1110], [300, 1060]];
  const photo = makePhoto(target, corners);

  const pxPerCm = pxPerCmFor(50, 50);
  const { gray } = warpTarget(photo, orderCorners(corners), 50, 50, pxPerCm);

  const dot = findWhiteDot(gray, pxPerCm);
  assert.ok(dot, "weißer Punkt gefunden");
  near(dot.x, 25, 0.3, "Punkt x"); near(dot.y, 25, 0.3, "Punkt y");

  const found = detectHoles(gray, pxPerCm, 7.62, 5, [{ x: dot.x, y: dot.y, r: dot.r * 1.3 }]);
  assert.equal(found.length, holes.length, `gefunden: ${JSON.stringify(found)}`);
  for (const h of holes) {
    assert.ok(found.some((f) => Math.hypot(f.x - h.x, f.y - h.y) < 0.4), `Loch bei ${h.x}/${h.y}`);
  }

  const c = computeCorrection(dot, found, 100, "mrad", 0.1);
  const exp = computeCorrection({ x: 25, y: 25 }, holes, 100, "mrad", 0.1);
  assert.equal(c.clicksUp, exp.clicksUp);
  assert.equal(c.clicksLeft, exp.clicksLeft);
});

test("Unscharfes Foto mit wenig Auflösung: Ringlinien werden nicht als Treffer gemeldet", () => {
  const holes = [
    { x: 28.0, y: 29.0 }, { x: 30.5, y: 27.0 }, { x: 26.0, y: 31.5 }, // im Schwarzen
    { x: 37.0, y: 33.0 }, { x: 13.9, y: 11.9 }, // auf Papier
    { x: 40.0, y: 25.0 }, // genau auf der 15-cm-Ringlinie
  ];
  const corners = [[400, 300], [900, 330], [880, 760], [420, 720]]; // etwa 10 Pixel pro cm
  const photo = makePhoto(makeTarget({ holes }), corners, 1200, 1000, { blur: 2 });
  const pxPerCm = pxPerCmFor(50, 50);
  const { gray } = warpTarget(photo, orderCorners(corners), 50, 50, pxPerCm);
  const dot = findWhiteDot(gray, pxPerCm);
  assert.ok(dot, "weißer Punkt gefunden");
  const found = detectHoles(gray, pxPerCm, 7.62, 5, [{ x: dot.x, y: dot.y, r: dot.r * 1.3 }]);
  assert.equal(found.length, holes.length, `gefunden: ${JSON.stringify(found)}`);
  for (const h of holes) {
    assert.ok(found.some((f) => Math.hypot(f.x - h.x, f.y - h.y) < 0.5), `Loch bei ${h.x}/${h.y}`);
  }
});

test("Flugbahn: Fleck sitzt auf der Einschießentfernung, Geschoss fällt danach", async () => {
  const { trajectory, geeZero } = await import("../ballistics.js");
  const opts = { v0: 825, bc: 0.298, sightHeightCm: 5, zeroM: 100, massG: 11.7 };
  const [d50, d100, d200, d300] = trajectory({ ...opts, distances: [50, 100, 200, 300] });
  near(d100.heightCm, 0, 0.1, "Fleck auf 100 m");
  assert.ok(d50.heightCm < 0 && d50.heightCm > -2, `50 m knapp unter Visierlinie: ${d50.heightCm}`);
  assert.ok(d200.heightCm < -8 && d200.heightCm > -20, `200 m: ${d200.heightCm}`);
  assert.ok(d300.heightCm < d200.heightCm, "fällt weiter");
  assert.ok(d300.v < d100.v && d100.v < 825, "wird langsamer");
  const g = geeZero(opts);
  assert.ok(g.zeroM > 150 && g.zeroM < 230, `GEE ${g.zeroM} m`);
  assert.ok(g.at100Cm > 2.5 && g.at100Cm <= 4.05, `auf 100 m ${g.at100Cm} cm hoch`);
});

test("Ohne Luftwiderstand stimmt die Flugbahn mit der Wurfparabel überein", async () => {
  const { trajectory } = await import("../ballistics.js");
  // Sehr großer BC = kaum Luftwiderstand. Fleck auf 100 m, Visierhöhe 0.
  const [r] = trajectory({ v0: 800, bc: 1e6, sightHeightCm: 0, zeroM: 100, massG: 10, distances: [200] });
  // Parabel durch 0 und 100 m: y(200) = -g/(2 v²) * 200 * (200 - 100)
  const expected = (-9.80665 / (2 * 800 * 800)) * 200 * 100 * 100;
  near(r.heightCm, expected, 0.3, "Fallhöhe auf 200 m");
});
