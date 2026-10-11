// Erzeugt ein künstliches "Handyfoto" einer Zielscheibe mit bekannten Einschüssen.
import { homography, applyHomography } from "../core.js";

export function makeTarget({
  widthCm = 50, heightCm = 50, pxPerCm = 20, holeMm = 7.62,
  holes = [], dot = { x: 25, y: 25, d: 2 }, blackR = 10,
}) {
  const W = Math.round(widthCm * pxPerCm);
  const H = Math.round(heightCm * pxPerCm);
  const gray = new Float32Array(W * H);
  const cx = 25 * pxPerCm, cy = 25 * pxPerCm;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = Math.hypot(x - cx, y - cy) / pxPerCm;
    let v = 235; // Papier
    if (r < blackR) v = 25; // schwarzer Spiegel
    else if ([12.5, 15, 17.5, 20].some((rr) => Math.abs(r - rr) < 0.08)) v = 30; // Ringlinien
    const xc = x / pxPerCm, yc = y / pxPerCm;
    if (dot && Math.hypot(xc - dot.x, yc - dot.y) < dot.d / 2) v = 245; // weißer Aufkleber
    for (const h of holes) {
      if (Math.hypot(xc - h.x, yc - h.y) < holeMm / 20) v = v < 128 || (dot && Math.hypot(xc - dot.x, yc - dot.y) < dot.d / 2) ? 150 : 40;
    }
    gray[y * W + x] = v;
  }
  return { gray, W, H };
}

/** Projiziert die Scheibe schräg in ein größeres Foto mit grauem Hintergrund und Rauschen. */
export function makePhoto(target, corners, photoW = 1600, photoH = 1200, { seed = 1, blur = 0 } = {}) {
  const { gray, W, H } = target;
  const Hm = homography(corners, [[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]]); // Foto -> Scheibe
  const data = new Uint8ClampedArray(photoW * photoH * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
  for (let y = 0; y < photoH; y++) for (let x = 0; x < photoW; x++) {
    const [u, v] = applyHomography(Hm, x, y);
    let g = 110 + 20 * Math.sin(x / 90); // Hintergrund (Holz/Erde)
    if (u >= 0 && v >= 0 && u < W - 1 && v < H - 1) g = gray[Math.round(v) * W + Math.round(u)];
    g += rnd() * 16;
    const o = (y * photoW + x) * 4;
    data[o] = g; data[o + 1] = g; data[o + 2] = g * 0.95; data[o + 3] = 255;
  }
  if (blur) boxBlur(data, photoW, photoH, blur);
  return { data, width: photoW, height: photoH };
}

// Unschärfe wie bei leicht verwackeltem oder nicht ganz scharfem Foto.
function boxBlur(data, w, h, r) {
  const src = new Uint8ClampedArray(data);
  const n = (2 * r + 1) ** 2;
  for (let y = r; y < h - r; y++) for (let x = r; x < w - r; x++) for (let k = 0; k < 3; k++) {
    let s = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) s += src[((y + dy) * w + x + dx) * 4 + k];
    data[(y * w + x) * 4 + k] = s / n;
  }
}
