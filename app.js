import {
  orderCorners,
  pxPerCmFor,
  warpTarget,
  detectHoles,
  findWhiteDot,
  computeCorrection,
  correctionLines,
  cmPerClick,
} from "./core.js";
import { trajectory, heightAt, geeZero } from "./ballistics.js";

// ---------------------------------------------------------------------------------------------
// Einstellungen

const DEFAULTS = { width: 50, height: 50, distance: 100, caliber: 7.8, caliberName: ".308 Win / .30-06 / .300 Win Mag / .300 WSM", unit: "mrad", click: 0.1, optic: "steiner-ranger6", sens: 5,
  ammo: "sb3006sp", v0: 825, bc: 0.298, mass: 11.7, sight: 5, zero: 100 };
const settings = { ...DEFAULTS, ...load("settings") };

function load(key) {
  try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privater Modus */ }
}

const $ = (id) => document.getElementById(id);
// Gängige Kaliber mit Geschossdurchmesser in mm. Die Lochgröße auf dem Papier hängt am Durchmesser,
// deshalb teilen sich Kaliber mit gleichem Geschoss einen Wert.
const CALIBERS = [
  ["Kurzwaffe", [
    [".22 lfB (.22 LR)", 5.7],
    ["9 mm Luger (9×19)", 9.0],
    [".38 Special / .357 Magnum", 9.1],
    [".40 S&W / 10 mm Auto", 10.2],
    [".44 Magnum", 10.9],
    [".45 ACP", 11.5],
  ]],
  ["Kleinkaliber und Varmint", [
    [".17 HMR", 4.4],
    [".22 WMR / .22 Hornet", 5.7],
    [".222 Rem / .223 Rem (5,56×45)", 5.7],
    [".22-250 Rem", 5.7],
  ]],
  ["Büchse", [
    [".243 Win / 6 mm Norma BR", 6.2],
    ["6,5 Creedmoor / 6,5×55 / 6,5×57 / 6,5 PRC", 6.7],
    [".270 Win / .270 WSM", 7.0],
    ["7×57 / 7×64 / 7 mm Rem Mag / 7 mm PRC", 7.2],
    [".308 Win / .30-06 / .300 Win Mag / .300 WSM", 7.8],
    ["7,62×39", 7.9],
    ["7,62×54 R / .303 British", 7.9],
    ["8×57 IS / 8×68 S", 8.2],
    [".338 Lapua Mag / .338 Win Mag", 8.6],
    ["9,3×62 / 9,3×74 R", 9.3],
    [".375 H&H", 9.5],
    [".45-70 Gov", 11.6],
  ]],
];

const calSelect = document.getElementById("s-calpreset");
calSelect.innerHTML =
  CALIBERS.map(([group, list]) =>
    `<optgroup label="${group}">` +
    list.map(([name, mm]) => `<option value="${name}" data-mm="${mm}">${name}</option>`).join("") +
    "</optgroup>").join("") +
  '<option value="">Eigenes Maß</option>';

function syncCaliberSelect() {
  // Gespeicherten Namen nehmen, solange sein Maß noch passt, sonst das erste Kaliber mit diesem Maß.
  const opts = [...calSelect.querySelectorAll("option[data-mm]")];
  const byName = opts.find((o) => o.value === settings.caliberName && Number(o.dataset.mm) === settings.caliber);
  const byMm = opts.find((o) => Number(o.dataset.mm) === settings.caliber);
  calSelect.value = (byName || byMm)?.value ?? "";
}

calSelect.addEventListener("change", () => {
  const opt = calSelect.selectedOptions[0];
  settings.caliberName = calSelect.value;
  if (opt && opt.dataset.mm) {
    settings.caliber = Number(opt.dataset.mm);
    $("s-caliber").value = settings.caliber;
  } else {
    $("s-caliber").focus();
  }
  save("settings", settings);
  if (state.corners.length === 4 && !$("step-result").hidden) analyse();
});

const fields = { width: "s-width", height: "s-height", distance: "s-distance", caliber: "s-caliber", unit: "s-unit", click: "s-click" };

for (const [k, id] of Object.entries(fields)) {
  $(id).value = settings[k];
  $(id).addEventListener("change", () => {
    const v = $(id).value;
    settings[k] = k === "unit" ? v : Number(v) || DEFAULTS[k];
    save("settings", settings);
    // Maße oder Kaliber geändert: neu entzerren bzw. neu erkennen.
    if (state.corners.length === 4 && !$("step-result").hidden) analyse();
  });
}
$("s-caliber").addEventListener("change", syncCaliberSelect);
syncCaliberSelect();

// Optiken mit ihrem Klickwert. Beim Wärmebild-Vorsatz wird nicht am Zielfernrohr gedreht, sondern
// im Einschießmenü des Vorsatzgeräts verschoben.
const OPTICS = [
  { id: "steiner-ranger6", name: "Steiner Ranger 6 3–18×56 (1 cm / 100 m)", unit: "mrad", click: 0.1, where: "am Zielfernrohr" },
  { id: "thunder3-tq50c", name: "Hikmicro Thunder 3.0 TQ50C, Vorsatz (1,3 cm / 100 m)", unit: "cm", click: 1.3, where: "im Einschießmenü des Vorsatzgeräts" },
];
$("s-optic").innerHTML =
  OPTICS.map((o) => `<option value="${o.id}">${o.name}</option>`).join("") + '<option value="">Eigene Werte</option>';

function currentOptic() {
  return OPTICS.find((o) => o.unit === settings.unit && o.click === settings.click && o.id === settings.optic)
    || OPTICS.find((o) => o.unit === settings.unit && o.click === settings.click);
}
function syncOpticSelect() {
  $("s-optic").value = currentOptic()?.id ?? "";
}
$("s-optic").addEventListener("change", () => {
  const o = OPTICS.find((x) => x.id === $("s-optic").value);
  settings.optic = $("s-optic").value;
  if (o) {
    settings.unit = o.unit;
    settings.click = o.click;
    $("s-unit").value = o.unit;
    $("s-click").value = o.click;
  }
  save("settings", settings);
  if (state.view) drawTarget();
});
$("s-unit").addEventListener("change", syncOpticSelect);
$("s-click").addEventListener("change", syncOpticSelect);
syncOpticSelect();
$("in-sens").value = settings.sens;

// ---------------------------------------------------------------------------------------------
// Flugbahn

// Herstellerangaben. Die Werte auf der eigenen Schachtel haben Vorrang.
const AMMO = [
  { id: "sb3006sp", name: "Sellier & Bellot .30-06 Teilmantel 11,7 g / 180 gr", v0: 825, bc: 0.298, mass: 11.7, caliber: 7.8 },
];

const ballisticFields = { v0: "b-v0", bc: "b-bc", mass: "b-mass", sight: "b-sight", zero: "b-zero" };

$("b-ammo").innerHTML =
  AMMO.map((a) => `<option value="${a.id}">${a.name}</option>`).join("") + '<option value="">Eigene Werte</option>';

function ballisticOpts() {
  return { v0: settings.v0, bc: settings.bc, sightHeightCm: settings.sight, zeroM: settings.zero, massG: settings.mass };
}

function syncAmmoSelect() {
  const a = AMMO.find((x) => x.id === settings.ammo);
  const same = a && a.v0 === settings.v0 && a.bc === settings.bc && a.mass === settings.mass;
  $("b-ammo").value = same ? a.id : "";
}

function renderBallistics() {
  for (const [k, id] of Object.entries(ballisticFields)) $(id).value = settings[k];
  syncAmmoSelect();
  let rows;
  try {
    const dists = [...new Set([50, 100, 150, 200, 250, 300, settings.zero])].sort((a, b) => a - b);
    rows = trajectory({ ...ballisticOpts(), distances: dists });
  } catch (e) {
    $("b-table").innerHTML = "";
    $("b-gee").textContent = e.message;
    return;
  }
  const head = "<tr><th>Entf.</th><th>Treffpunkt</th><th>Klicks</th><th>m/s</th><th>Joule</th></tr>";
  const body = rows.map((r) => {
    const step = cmPerClick(r.distance, settings.unit, settings.click);
    const clicks = Math.round(-r.heightCm / step) || 0;
    const clickTxt = clicks > 0 ? `${clicks} hoch` : clicks < 0 ? `${-clicks} tief` : "0";
    const sign = r.heightCm > 0.05 ? "+" : r.heightCm < -0.05 ? "−" : "";
    return `<tr class="${r.distance === settings.zero ? "zero" : ""}"><td>${r.distance} m</td>` +
      `<td>${sign}${fmt(Math.abs(r.heightCm))} cm</td><td>${clickTxt}</td>` +
      `<td>${Math.round(r.v)}</td><td>${r.energyJ ? Math.round(r.energyJ) : "–"}</td></tr>`;
  }).join("");
  $("b-table").innerHTML = head + body;
  const g = geeZero(ballisticOpts());
  $("b-gee").textContent = g
    ? `GEE (höchstens 4 cm über dem Haltepunkt): Fleck auf ${g.zeroM} m, dafür auf 100 m ${fmt(g.at100Cm)} cm hoch einschießen.`
    : "";
}

$("b-ammo").addEventListener("change", () => {
  const a = AMMO.find((x) => x.id === $("b-ammo").value);
  settings.ammo = $("b-ammo").value;
  if (a) Object.assign(settings, { v0: a.v0, bc: a.bc, mass: a.mass });
  save("settings", settings);
  renderBallistics();
});
for (const [k, id] of Object.entries(ballisticFields)) {
  $(id).addEventListener("change", () => {
    const v = Number($(id).value);
    settings[k] = Number.isFinite(v) && (v > 0 || k === "sight") ? v : DEFAULTS[k];
    save("settings", settings);
    renderBallistics();
    if (state.view) updateView();
  });
}
$("btn-gee").onclick = () => {
  const g = geeZero(ballisticOpts());
  if (!g) return;
  settings.zero = g.zeroM;
  save("settings", settings);
  renderBallistics();
  if (state.view) updateView();
};
$("btn-ballistics").onclick = () => {
  $("ballistics").hidden = !$("ballistics").hidden;
  $("settings").hidden = true;
  if (!$("ballistics").hidden) renderBallistics();
};
$("btn-ballistics-done").onclick = () => ($("ballistics").hidden = true);

/** Wie viel cm über dem weißen Punkt die Treffer auf der Schussentfernung sitzen sollen. */
function aimRaiseCm() {
  if (settings.zero === settings.distance) return 0;
  try { return heightAt(ballisticOpts(), settings.distance); } catch { return 0; }
}

$("btn-settings").onclick = () => {
  $("settings").hidden = !$("settings").hidden;
  $("ballistics").hidden = true;
};
$("btn-settings-done").onclick = () => ($("settings").hidden = true);

// ---------------------------------------------------------------------------------------------
// Zustand

const state = {
  photo: null, // Canvas mit dem Foto in voller (begrenzter) Auflösung
  corners: [], // Ecken im Foto (Pixel)
  target: null, // Ergebnis von warpTarget
  pxPerCm: 1,
  hits: [], // { x, y, manual } in cm
  removed: [], // automatisch erkannte Treffer, die der Nutzer gelöscht hat
  dot: null, // weißer Punkt { x, y, r } in cm
  mode: "group",
  settingDot: false,
  zoom: true, // Ausschnitt um die Treffer statt ganzer Scheibe
  view: null, // sichtbarer Bereich in cm { x, y, w, h }
};

function show(step) {
  for (const id of ["step-photo", "step-corners", "step-result"]) $(id).hidden = id !== step;
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------------------------
// Schritt 1: Foto

const MAX_DIM = 3000;

async function onFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bmp = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  state.photo = c;
  state.corners = [];
  state.hits = [];
  state.removed = [];
  state.dot = null;
  show("step-corners");
  drawPhoto();
}
$("in-camera").addEventListener("change", onFile);
$("in-file").addEventListener("change", onFile);

// ---------------------------------------------------------------------------------------------
// Schritt 2: Ecken

const cvPhoto = $("cv-photo");
let drag = null; // { index, x, y } während des Ziehens

function fitCanvas(cv, w, h) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = cv.parentElement.clientWidth;
  const maxCssH = window.innerHeight * 0.7;
  const scale = Math.min(cssW / w, maxCssH / h);
  cv.style.width = `${w * scale}px`;
  cv.style.height = `${h * scale}px`;
  cv.width = Math.round(w * scale * dpr);
  cv.height = Math.round(h * scale * dpr);
  return { scale: scale * dpr, dpr };
}

function eventPos(cv, ev, unitsPerCanvasPx) {
  const r = cv.getBoundingClientRect();
  const x = ((ev.clientX - r.left) / r.width) * cv.width;
  const y = ((ev.clientY - r.top) / r.height) * cv.height;
  return [x / unitsPerCanvasPx, y / unitsPerCanvasPx];
}

let photoView = { scale: 1, dpr: 1 };

function drawPhoto() {
  const p = state.photo;
  if (!p) return;
  photoView = fitCanvas(cvPhoto, p.width, p.height);
  const ctx = cvPhoto.getContext("2d");
  const s = photoView.scale;
  ctx.drawImage(p, 0, 0, cvPhoto.width, cvPhoto.height);

  const pts = state.corners;
  const ordered = pts.length === 4 ? orderCorners(pts) : pts;
  ctx.lineWidth = 2 * photoView.dpr;
  ctx.strokeStyle = "#3cc7e5";
  if (ordered.length > 1) {
    ctx.beginPath();
    ordered.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
    if (ordered.length === 4) ctx.closePath();
    ctx.stroke();
  }
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.arc(x * s, y * s, 10 * photoView.dpr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x * s, y * s, 2 * photoView.dpr, 0, Math.PI * 2);
    ctx.fillStyle = "#3cc7e5";
    ctx.fill();
  }
  if (drag) drawLoupe(ctx, drag.x, drag.y);

  $("btn-corners-done").disabled = pts.length !== 4;
  $("corner-hint").textContent =
    pts.length < 4
      ? `Tippe die Ecken der Scheibe an (${pts.length} von 4). Halte gedrückt und schiebe zum Feinjustieren.`
      : "Alle 4 Ecken gesetzt. Zum Korrigieren eine Ecke ziehen, dann auf Weiter.";
}

function drawLoupe(ctx, x, y) {
  // Lupe in der Ecke, die vom Finger weiter weg ist.
  const d = photoView.dpr;
  const R = 70 * d;
  const zoom = 4;
  const s = photoView.scale;
  const left = x * s > cvPhoto.width / 2;
  const cx = left ? R + 8 * d : cvPhoto.width - R - 8 * d;
  const cy = R + 8 * d;
  const srcR = R / s / zoom;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(state.photo, x - srcR, y - srcR, srcR * 2, srcR * 2, cx - R, cy - R, R * 2, R * 2);
  ctx.strokeStyle = "#e5483c";
  ctx.lineWidth = 1.5 * d;
  ctx.beginPath();
  ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2 * d;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
}

cvPhoto.addEventListener("pointerdown", (ev) => {
  const [x, y] = eventPos(cvPhoto, ev, photoView.scale);
  const grab = (44 * photoView.dpr) / photoView.scale;
  let index = -1, best = grab;
  state.corners.forEach(([cx, cy], i) => {
    const d = Math.hypot(cx - x, cy - y);
    if (d < best) { best = d; index = i; }
  });
  if (index < 0) {
    if (state.corners.length >= 4) return;
    state.corners.push([x, y]);
    index = state.corners.length - 1;
  }
  drag = { index, x, y, ox: state.corners[index][0] - x, oy: state.corners[index][1] - y };
  cvPhoto.setPointerCapture(ev.pointerId);
  drawPhoto();
});
cvPhoto.addEventListener("pointermove", (ev) => {
  if (!drag) return;
  const [x, y] = eventPos(cvPhoto, ev, photoView.scale);
  const p = state.photo;
  const nx = Math.max(0, Math.min(p.width - 1, x + drag.ox));
  const ny = Math.max(0, Math.min(p.height - 1, y + drag.oy));
  state.corners[drag.index] = [nx, ny];
  drag.x = nx;
  drag.y = ny;
  drawPhoto();
});
const endDrag = () => { drag = null; drawPhoto(); };
cvPhoto.addEventListener("pointerup", endDrag);
cvPhoto.addEventListener("pointercancel", endDrag);

$("btn-corners-reset").onclick = () => { state.corners = []; drawPhoto(); };
$("btn-corners-done").onclick = () => {
  state.hits = [];
  state.removed = [];
  state.dot = null;
  show("step-result");
  // Erst anzeigen, dann rechnen, damit der Wechsel sofort sichtbar ist.
  state.view = null;
  $("result-box").innerHTML = '<div class="small">Rechne …</div>';
  setTimeout(analyse, 30);
};

// ---------------------------------------------------------------------------------------------
// Schritt 3: Auswertung

const cvTarget = $("cv-target");
let targetView = { scale: 1, dpr: 1 };
let targetBitmap = null;

function analyse() {
  const p = state.photo;
  const img = p.getContext("2d").getImageData(0, 0, p.width, p.height);
  state.pxPerCm = pxPerCmFor(settings.width, settings.height);
  state.target = warpTarget(img, orderCorners(state.corners), settings.width, settings.height, state.pxPerCm);
  const t = state.target.rgba;
  targetBitmap = document.createElement("canvas");
  targetBitmap.width = t.width;
  targetBitmap.height = t.height;
  targetBitmap.getContext("2d").putImageData(new ImageData(t.data, t.width, t.height), 0, 0);
  if (!state.dot || state.dot.auto) {
    const found = findWhiteDot(state.target.gray, state.pxPerCm);
    state.dot = found ? { ...found, auto: true } : null;
  }
  redetect();
  updateView();
}

/** Legt den sichtbaren Ausschnitt fest. Nur beim Auswerten und Umschalten, nicht bei jedem Tippen. */
function updateView() {
  const W = settings.width, H = settings.height;
  const raise = aimRaiseCm();
  const pts = [...state.hits, ...(state.dot ? [state.dot, { x: state.dot.x, y: state.dot.y - raise }] : [])];
  $("btn-zoom").textContent = state.zoom ? "Ganze Scheibe" : "Ausschnitt";
  if (!state.zoom || !pts.length) {
    state.view = { x: 0, y: 0, w: W, h: H };
  } else {
    const pad = 4;
    const x0 = Math.min(...pts.map((p) => p.x)) - pad, x1 = Math.max(...pts.map((p) => p.x)) + pad;
    const y0 = Math.min(...pts.map((p) => p.y)) - pad, y1 = Math.max(...pts.map((p) => p.y)) + pad;
    // Seitenverhältnis der Scheibe beibehalten, mindestens 14 cm breit.
    let w = Math.max(x1 - x0, ((y1 - y0) * W) / H, Math.min(14, W));
    w = Math.min(w, W);
    const h = (w * H) / W;
    const x = Math.max(0, Math.min(W - w, (x0 + x1) / 2 - w / 2));
    const y = Math.max(0, Math.min(H - h, (y0 + y1) / 2 - h / 2));
    state.view = { x, y, w, h };
  }
  drawTarget();
}

function redetect() {
  const exclude = state.dot ? [{ x: state.dot.x, y: state.dot.y, r: state.dot.r * 1.3 }] : [];
  const found = detectHoles(state.target.gray, state.pxPerCm, settings.caliber, settings.sens, exclude)
    .filter((h) => !state.removed.some((r) => Math.hypot(r.x - h.x, r.y - h.y) < 0.5));
  state.hits = [...found.map((h) => ({ ...h, manual: false })), ...state.hits.filter((h) => h.manual)];
  if (state.view) drawTarget();
}

$("in-sens").addEventListener("input", () => {
  settings.sens = Number($("in-sens").value);
  save("settings", settings);
  if (state.target) redetect();
});

function drawTarget() {
  const v = state.view;
  const p = state.pxPerCm;
  targetView = fitCanvas(cvTarget, v.w * p, v.h * p);
  const ctx = cvTarget.getContext("2d");
  const d = targetView.dpr;
  const k = targetView.scale * p; // Canvas-Pixel pro cm
  ctx.drawImage(targetBitmap, v.x * p, v.y * p, v.w * p, v.h * p, 0, 0, cvTarget.width, cvTarget.height);
  ctx.save();
  ctx.translate(-v.x * k, -v.y * k);

  const r = Math.max((settings.caliber / 20) * k * 1.6, 9 * d);
  ctx.lineWidth = 3 * d;
  ctx.strokeStyle = "#ff2a1f";
  ctx.fillStyle = "#ff2a1f";
  ctx.font = `bold ${12 * d}px system-ui, sans-serif`;
  state.hits.forEach((h, i) => {
    ctx.beginPath();
    ctx.arc(h.x * k, h.y * k, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(String(i + 1), h.x * k + r + 2 * d, h.y * k - r);
  });

  const zero = state.mode === "zero";
  const raise = zero ? aimRaiseCm() : 0;
  const aim = state.dot ? { x: state.dot.x, y: state.dot.y - raise } : null;
  const corr = zero && aim ? computeCorrection(aim, state.hits, settings.distance, settings.unit, settings.click) : null;
  if (zero && aim && raise) {
    // Soll-Treffpunkt, wenn der Fleck auf einer anderen Entfernung liegen soll.
    ctx.strokeStyle = "#3cc7e5";
    ctx.lineWidth = 2 * d;
    ctx.setLineDash([4 * d, 4 * d]);
    ctx.beginPath();
    ctx.arc(aim.x * k, aim.y * k, 10 * d, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (zero && state.dot) {
    const { x, y } = state.dot;
    ctx.strokeStyle = "#3cc7e5";
    ctx.lineWidth = 2 * d;
    const a = 14 * d;
    ctx.beginPath();
    ctx.moveTo(x * k - a, y * k); ctx.lineTo(x * k + a, y * k);
    ctx.moveTo(x * k, y * k - a); ctx.lineTo(x * k, y * k + a);
    ctx.stroke();
  }
  if (state.hits.length > 1 || corr) {
    const mx = state.hits.reduce((sum, h) => sum + h.x, 0) / state.hits.length;
    const my = state.hits.reduce((sum, h) => sum + h.y, 0) / state.hits.length;
    if (corr) {
      ctx.setLineDash([6 * d, 5 * d]);
      ctx.strokeStyle = "#ffd23c";
      ctx.lineWidth = 2 * d;
      ctx.beginPath();
      ctx.moveTo(aim.x * k, aim.y * k);
      ctx.lineTo(mx * k, my * k);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (state.hits.length) {
      ctx.strokeStyle = "#ffd23c";
      ctx.lineWidth = 3 * d;
      const a = 8 * d;
      ctx.beginPath();
      ctx.moveTo(mx * k - a, my * k - a); ctx.lineTo(mx * k + a, my * k + a);
      ctx.moveTo(mx * k + a, my * k - a); ctx.lineTo(mx * k - a, my * k + a);
      ctx.stroke();
    }
  }

  ctx.restore();
  renderResult(corr, raise);
}

const fmt = (v, digits = 1) => v.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

function renderResult(corr, raise = 0) {
  const box = $("result-box");
  const n = state.hits.length;
  const zero = state.mode === "zero";
  $("btn-set-dot").hidden = !zero;
  $("btn-set-dot").classList.toggle("active-tool", state.settingDot);

  if (state.settingDot) {
    $("target-hint").textContent = "Tippe jetzt auf die Mitte des weißen Punkts.";
  } else if (zero) {
    $("target-hint").textContent = "Gelb: mittlerer Treffpunkt. Tippe auf einen roten Kreis zum Entfernen oder auf ein Loch, das fehlt.";
  } else {
    $("target-hint").textContent = "Tippe auf einen roten Kreis zum Entfernen oder auf ein Loch, das fehlt.";
  }

  if (zero) {
    if (!state.dot) {
      box.innerHTML = '<div class="small">Kein weißer Punkt gefunden. Tippe auf „Punkt setzen“ und dann auf den Punkt.</div>';
      return;
    }
    if (!corr) {
      box.innerHTML = '<div class="small">Noch keine Treffer erkannt. Tippe die Einschüsse an.</div>';
      return;
    }
    const where = [
      corr.offsetLowCm >= 0 ? `${fmt(corr.offsetLowCm)} cm zu tief` : `${fmt(-corr.offsetLowCm)} cm zu hoch`,
      corr.offsetRightCm >= 0 ? `${fmt(corr.offsetRightCm)} cm zu weit rechts` : `${fmt(-corr.offsetRightCm)} cm zu weit links`,
    ].join(", ");
    const target = raise
      ? `Soll: ${fmt(Math.abs(raise))} cm ${raise > 0 ? "über" : "unter"} dem Punkt (Fleck auf ${settings.zero} m, blauer Kreis). `
      : "";
    box.innerHTML =
      `<div class="big">${correctionLines(corr).join("<br>")}</div>` +
      `<div class="small">${target}${n} ${n === 1 ? "Schuss" : "Schüsse"}, Treffpunkt ${where}${raise ? " vom Soll" : ""}. ` +
      `1 Klick = ${fmt(cmPerClick(settings.distance, settings.unit, settings.click), 2)} cm auf ${settings.distance} m` +
      `${currentOptic() ? ", " + currentOptic().where : ""}.</div>`;
    return;
  }

  let spread = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    spread = Math.max(spread, Math.hypot(state.hits[i].x - state.hits[j].x, state.hits[i].y - state.hits[j].y));
  }
  // Streukreis von Lochmitte zu Lochmitte, zusätzlich als Winkel.
  const perUnit = cmPerClick(settings.distance, settings.unit, 1);
  box.innerHTML =
    `<div class="big">${n} ${n === 1 ? "Treffer" : "Treffer"}</div>` +
    (n > 1
      ? `<div class="small">Streukreis ${fmt(spread)} cm` +
        (settings.unit === "cm" ? "" : ` (${fmt(spread / perUnit, 2)} ${settings.unit.toUpperCase()})`) + ", Mitte zu Mitte.</div>"
      : "");
}

function setMode(mode) {
  state.mode = mode;
  state.settingDot = false;
  $("tab-group").setAttribute("aria-selected", String(mode === "group"));
  $("tab-zero").setAttribute("aria-selected", String(mode === "zero"));
  if (state.view) drawTarget();
}
$("tab-group").onclick = () => setMode("group");
$("tab-zero").onclick = () => setMode("zero");
$("btn-set-dot").onclick = () => { state.settingDot = !state.settingDot; drawTarget(); };

cvTarget.addEventListener("pointerdown", (ev) => {
  if (!state.view) return;
  const [px, py] = eventPos(cvTarget, ev, targetView.scale);
  const x = px / state.pxPerCm + state.view.x;
  const y = py / state.pxPerCm + state.view.y;
  if (state.settingDot) {
    state.dot = { x, y, r: 1, auto: false };
    state.settingDot = false;
    redetect();
    updateView();
    return;
  }
  const grab = Math.max((16 * targetView.dpr) / (targetView.scale * state.pxPerCm), settings.caliber / 10);
  let index = -1, best = grab;
  state.hits.forEach((h, i) => {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d < best) { best = d; index = i; }
  });
  if (index >= 0) {
    const [h] = state.hits.splice(index, 1);
    if (!h.manual) state.removed.push(h);
  } else {
    state.hits.push({ x, y, manual: true });
  }
  drawTarget();
});

$("btn-zoom").onclick = () => { state.zoom = !state.zoom; updateView(); };
$("btn-edit-corners").onclick = () => { show("step-corners"); drawPhoto(); };
$("btn-new-photo").onclick = () => show("step-photo");

window.addEventListener("resize", () => {
  if (!$("step-corners").hidden) drawPhoto();
  if (!$("step-result").hidden && state.view) drawTarget();
});

// Offline-Betrieb
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
