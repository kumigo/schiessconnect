// Rechenkern der Foto-App: Entzerren, Einschüsse finden, weißen Punkt finden, Klicks berechnen.
// Reine Funktionen ohne DOM, damit sie im Browser und in Node-Tests gleich laufen.
// Graubilder sind { data: Float32Array, width, height } mit Werten 0..255.

// Wie viele Zentimeter eine Einheit auf 100 m ausmacht.
// "cm" heißt: Klickwert in Zentimetern auf 100 m, wie bei vielen Wärmebildgeräten angegeben.
export const CM_PER_UNIT_AT_100M = { mrad: 10.0, moa: 2.908, cm: 1.0 };

// ---------------------------------------------------------------------------------------------
// Ecken und Perspektive

/** Bringt 4 beliebig angetippte Punkte in die Reihenfolge oben links, oben rechts, unten rechts, unten links. */
export function orderCorners(points) {
  if (points.length !== 4) throw new Error("Es werden genau 4 Ecken benötigt.");
  const cx = points.reduce((s, p) => s + p[0], 0) / 4;
  const cy = points.reduce((s, p) => s + p[1], 0) / 4;
  // Nach Winkel um die Mitte sortieren (Bildkoordinaten: y nach unten, also im Uhrzeigersinn).
  const sorted = [...points].sort(
    (a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx),
  );
  // Die Ecke mit der kleinsten Summe x+y ist oben links.
  let start = 0;
  for (let i = 1; i < 4; i++) {
    if (sorted[i][0] + sorted[i][1] < sorted[start][0] + sorted[start][1]) start = i;
  }
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
}

/** 3x3-Homographie (als 9er-Array, zeilenweise), die src[i] auf dst[i] abbildet. */
export function homography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return [...h, 1];
}

export function applyHomography(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

function solve(A, b) {
  // Gauß-Elimination mit Spaltenpivotisierung.
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error("Ecken liegen auf einer Linie.");
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Pixel pro Zentimeter für die entzerrte Scheibe: die längere Seite bekommt etwa 1200 Pixel. */
export function pxPerCmFor(widthCm, heightCm) {
  return 1200 / Math.max(widthCm, heightCm);
}

/**
 * Entzerrt das Foto zu einer Draufsicht der Scheibe.
 * rgba: { data: Uint8ClampedArray (RGBA), width, height } des Fotos.
 * corners: Ecken der Scheibe im Foto (oben links, oben rechts, unten rechts, unten links).
 * Gibt { rgba, gray } der entzerrten Scheibe zurück.
 */
export function warpTarget(rgba, corners, widthCm, heightCm, pxPerCm) {
  const W = Math.round(widthCm * pxPerCm);
  const Hh = Math.round(heightCm * pxPerCm);
  const dst = [[0, 0], [W - 1, 0], [W - 1, Hh - 1], [0, Hh - 1]];
  const H = homography(dst, corners); // Draufsicht -> Foto
  const out = new Uint8ClampedArray(W * Hh * 4);
  const gray = new Float32Array(W * Hh);
  const { data, width, height } = rgba;
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const [sx, sy] = applyHomography(H, x, y);
      const o = (y * W + x) * 4;
      if (sx < 0 || sy < 0 || sx > width - 1 || sy > height - 1) {
        out[o + 3] = 255;
        continue;
      }
      // Bilinear interpolieren.
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < 3; c++) {
        const a = data[(y0 * width + x0) * 4 + c];
        const bb = data[(y0 * width + x1) * 4 + c];
        const cc = data[(y1 * width + x0) * 4 + c];
        const d = data[(y1 * width + x1) * 4 + c];
        out[o + c] = (a * (1 - fx) + bb * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
      }
      out[o + 3] = 255;
      gray[y * W + x] = 0.299 * out[o] + 0.587 * out[o + 1] + 0.114 * out[o + 2];
    }
  }
  return { rgba: { data: out, width: W, height: Hh }, gray: { data: gray, width: W, height: Hh } };
}

// ---------------------------------------------------------------------------------------------
// Bildverarbeitung

function boxMean(gray, r) {
  // Mittelwert über ein (2r+1)²-Fenster per Integralbild.
  const { data, width: w, height: h } = gray;
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** Zusammenhängende Flächen einer Maske (Uint8Array, 1 = gesetzt). */
function components(mask, w, h) {
  const label = new Int32Array(w * h);
  const comps = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]) continue;
    const id = comps.length + 1;
    const c = { area: 0, sx: 0, sy: 0, minX: w, minY: h, maxX: 0, maxY: 0, pixels: [] };
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i - x) / w;
      c.area++;
      c.sx += x;
      c.sy += y;
      c.pixels.push(i);
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
      if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && mask[i - w] && !label[i - w]) { label[i - w] = id; stack.push(i - w); }
      if (y < h - 1 && mask[i + w] && !label[i + w]) { label[i + w] = id; stack.push(i + w); }
    }
    c.cx = c.sx / c.area;
    c.cy = c.sy / c.area;
    c.bw = c.maxX - c.minX + 1;
    c.bh = c.maxY - c.minY + 1;
    comps.push(c);
  }
  return comps;
}

/**
 * Sucht Einschusslöcher auf der entzerrten Scheibe.
 *
 * Ein Loch ist eine kleine, volle, runde Stelle, die sich deutlich von ihrer Umgebung abhebt:
 * dunkel auf weißem Papier oder hell im schwarzen Spiegel (dort scheint der Hintergrund durch).
 * Gesucht werden die stärksten Stellen im geglätteten Bild; jede muss innen voll (keine dünne
 * Ringlinie) und außen ringsum anders sein (kein Rand des Spiegels, keine große Ziffer).
 * sensitivity 1..10: höher findet mehr, aber auch mehr Fehltreffer.
 * exclude: Punkte in cm (z. B. der weiße Punkt) mit Radius, in deren Nähe nichts gemeldet wird.
 * Gibt Mittelpunkte in Zentimetern zurück.
 */
export function detectHoles(gray, pxPerCm, holeDiameterMm, sensitivity = 5, exclude = []) {
  const { data, width: w, height: h } = gray;
  const rPx = Math.max(1.5, (holeDiameterMm / 10 / 2) * pxPerCm);
  // Leicht glätten (etwa halbe Lochgröße): Rauschen und dünne Ringlinien verlieren dabei viel
  // mehr Kontrast als ein rundes Loch, das größer als das Glättungsfenster ist.
  const smooth = boxMean(gray, Math.max(1, Math.round(0.5 * rPx)));
  const mean = boxMean(gray, Math.max(3, Math.round(4 * rPx)));
  const threshold = 95 - sensitivity * 7; // 1 -> 88, 5 -> 60, 10 -> 25
  const contrast = new Float32Array(w * h);
  for (let i = 0; i < contrast.length; i++) contrast[i] = Math.abs(smooth[i] - mean[i]);

  const margin = Math.max(Math.round(0.5 * pxPerCm), Math.ceil(2.5 * rPx)); // Papierrand ignorieren
  const nms = Math.max(2, Math.round(1.5 * rPx));
  const found = [];
  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const i = y * w + x;
      const c = contrast[i];
      if (c <= threshold) continue;
      // Nur das stärkste Pixel in seiner Umgebung ist ein Kandidat.
      let isMax = true;
      for (let dy = -nms; dy <= nms && isMax; dy++) {
        const row = (y + dy) * w;
        for (let dx = -nms; dx <= nms; dx++) {
          const v = contrast[row + x + dx];
          if (v > c || (v === c && (dy < 0 || (dy === 0 && dx < 0)))) { isMax = false; break; }
        }
      }
      if (!isMax) continue;
      const sign = smooth[i] < mean[i] ? -1 : 1;
      if (ringCount(data, mean, w, h, x, y, 0.5 * rPx, (v, m) => sign * (v - m) > threshold / 2) < 12) continue;
      const center = smooth[i];
      if (ringCount(data, mean, w, h, x, y, 2.2 * rPx, (v) => sign * (center - v) > threshold / 2) < 13) continue;
      const blob = refine(data, mean, w, h, x, y, 1.5 * rPx, sign, threshold / 2);
      if (!blob || blob.elongation > 3) continue; // länglich: Stück einer (unscharfen) Linie
      const { cx, cy } = blob;
      const xCm = cx / pxPerCm;
      const yCm = cy / pxPerCm;
      if (exclude.some((e) => Math.hypot(e.x - xCm, e.y - yCm) < e.r)) continue;
      if (found.some((f) => Math.hypot(f.x - xCm, f.y - yCm) < rPx / pxPerCm)) continue;
      found.push({ x: xCm, y: yCm });
    }
  }
  return found;
}

/** Wie viele von 16 Punkten auf einem Kreis um (cx, cy) die Bedingung test(wert, umfeld) erfüllen. */
function ringCount(data, mean, w, h, cx, cy, r, test) {
  let ok = 0;
  for (let k = 0; k < 16; k++) {
    const x = Math.round(cx + r * Math.cos((Math.PI * k) / 8));
    const y = Math.round(cy + r * Math.sin((Math.PI * k) / 8));
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = y * w + x;
    if (test(data[i], mean[i])) ok++;
  }
  return ok;
}

/** Schwerpunkt und Streckung der Lochpixel um den Kandidaten. */
function refine(data, mean, w, h, cx, cy, r, sign, minContrast) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 0;
  const R = Math.ceil(r);
  for (let y = Math.max(0, cy - R); y <= Math.min(h - 1, cy + R); y++) {
    for (let x = Math.max(0, cx - R); x <= Math.min(w - 1, cx + R); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = y * w + x;
      if (sign * (data[i] - mean[i]) > minContrast) {
        sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; n++;
      }
    }
  }
  if (n < 3) return null;
  const mx = sx / n, my = sy / n;
  const vxx = sxx / n - mx * mx, vyy = syy / n - my * my, vxy = sxy / n - mx * my;
  // Eigenwerte der Kovarianz: Verhältnis groß = länglich.
  const tr = vxx + vyy;
  const disc = Math.sqrt(Math.max(0, (vxx - vyy) ** 2 / 4 + vxy * vxy));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
  return { cx: mx, cy: my, elongation: l1 / l2 };
}

function otsu(data) {
  const hist = new Float64Array(256);
  for (let i = 0; i < data.length; i++) hist[Math.max(0, Math.min(255, Math.round(data[i])))]++;
  const total = data.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; bestT = t; }
  }
  return bestT;
}

/**
 * Sucht einen hellen, runden Aufkleber auf dunklem Grund (z. B. im schwarzen Spiegel).
 * Gibt { x, y, r } in Zentimetern zurück oder null.
 */
export function findWhiteDot(gray, pxPerCm, minDCm = 1.0, maxDCm = 8.0) {
  const { data, width: w, height: h } = gray;
  const t = otsu(data);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) if (data[i] > t) mask[i] = 1;
  const minArea = Math.PI * ((minDCm * pxPerCm) / 2) ** 2;
  const maxArea = Math.PI * ((maxDCm * pxPerCm) / 2) ** 2;
  let best = null, bestScore = 0;
  for (const c of components(mask, w, h)) {
    if (c.area < minArea || c.area > maxArea) continue;
    const r = Math.max(c.bw, c.bh) / 2;
    const roundness = c.area / (Math.PI * r * r);
    if (roundness < 0.7 || Math.min(c.bw, c.bh) / Math.max(c.bw, c.bh) < 0.75) continue;
    // Der Punkt muss von dunklem Grund umgeben sein.
    let inSum = 0;
    for (const i of c.pixels) inSum += data[i];
    let ringSum = 0, ringN = 0;
    const r1 = 1.2 * r, r2 = 1.8 * r;
    for (let y = Math.max(0, Math.floor(c.cy - r2)); y <= Math.min(h - 1, Math.ceil(c.cy + r2)); y++) {
      for (let x = Math.max(0, Math.floor(c.cx - r2)); x <= Math.min(w - 1, Math.ceil(c.cx + r2)); x++) {
        const d = Math.hypot(x - c.cx, y - c.cy);
        if (d >= r1 && d <= r2) { ringSum += data[y * w + x]; ringN++; }
      }
    }
    if (!ringN) continue;
    const contrast = inSum / c.area - ringSum / ringN;
    if (contrast < 60) continue;
    const score = roundness * contrast;
    if (score > bestScore) {
      bestScore = score;
      best = { x: c.cx / pxPerCm, y: c.cy / pxPerCm, r: r / pxPerCm };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Einschießen

export function cmPerClick(distanceM, clickUnit, clickValue) {
  const perUnit = CM_PER_UNIT_AT_100M[String(clickUnit).toLowerCase()];
  if (perUnit === undefined) throw new Error(`Unbekannte Klick-Einheit '${clickUnit}', erlaubt: mrad, moa, cm`);
  return (perUnit * clickValue * distanceM) / 100;
}

function roundHalfUp(v) {
  // Kaufmännisch runden, damit 2.5 zu 3 wird und -2.5 zu -3.
  return Math.floor(Math.abs(v) + 0.5) * (v >= 0 ? 1 : -1) || 0;
}

/**
 * Klicks, um den mittleren Treffpunkt auf den Haltepunkt (weißer Punkt) zu schieben.
 * Man dreht den Turm in die Richtung, in die der Treffpunkt wandern soll: Treffer zu tief
 * bedeutet HOCH drehen, Treffer zu weit rechts bedeutet LINKS drehen.
 * aim und impacts in cm (x nach rechts, y nach unten).
 */
export function computeCorrection(aim, impacts, distanceM, clickUnit, clickValue) {
  if (!impacts.length) return null;
  const mx = impacts.reduce((s, p) => s + p.x, 0) / impacts.length;
  const my = impacts.reduce((s, p) => s + p.y, 0) / impacts.length;
  const right = mx - aim.x;
  const low = my - aim.y;
  const step = cmPerClick(distanceM, clickUnit, clickValue);
  return {
    meanX: mx,
    meanY: my,
    offsetRightCm: right,
    offsetLowCm: low,
    clicksUp: roundHalfUp(low / step),
    clicksLeft: roundHalfUp(right / step),
    shots: impacts.length,
  };
}

/** Anzeigetexte zu einer Korrektur. */
export function correctionLines(c) {
  const lines = [];
  if (c.clicksUp > 0) lines.push(`${c.clicksUp} Klicks HOCH`);
  else if (c.clicksUp < 0) lines.push(`${-c.clicksUp} Klicks TIEF`);
  else lines.push("Höhe passt");
  if (c.clicksLeft > 0) lines.push(`${c.clicksLeft} Klicks LINKS`);
  else if (c.clicksLeft < 0) lines.push(`${-c.clicksLeft} Klicks RECHTS`);
  else lines.push("Seite passt");
  return lines;
}
