// Flugbahn eines Geschosses mit G1-Luftwiderstand (Punktmassenmodell), Normalluft auf Meereshöhe.
// Reine Funktionen ohne DOM.

// Widerstandsbeiwert des G1-Standardgeschosses über der Machzahl.
const G1 = [
  [0.0, 0.2629], [0.5, 0.2032], [0.6, 0.2034], [0.7, 0.2165], [0.75, 0.2328], [0.8, 0.2546],
  [0.85, 0.2901], [0.9, 0.3415], [0.95, 0.4084], [1.0, 0.4805], [1.05, 0.5427], [1.1, 0.5883],
  [1.15, 0.6204], [1.2, 0.6411], [1.25, 0.6534], [1.3, 0.6589], [1.35, 0.6592], [1.4, 0.6559],
  [1.5, 0.6470], [1.6, 0.6364], [1.7, 0.6239], [1.8, 0.6104], [1.9, 0.5961], [2.0, 0.5814],
  [2.2, 0.5519], [2.4, 0.5242], [2.6, 0.4985], [2.8, 0.4753], [3.0, 0.4552], [3.5, 0.4140],
  [4.0, 0.3800],
];

const RHO = 1.225; // kg/m³, Normalluft 15 °C, Meereshöhe
const SOUND = 340.3; // m/s
const GRAVITY = 9.80665;
// Standardgeschoss: 1 lb Masse, 1 Zoll Durchmesser. Der BC (lb/in²) skaliert dessen Verzögerung.
const STD_AREA_PER_MASS = (Math.PI / 4) * 0.0254 ** 2 / 0.45359237;

function cdG1(mach) {
  if (mach <= G1[0][0]) return G1[0][1];
  for (let i = 1; i < G1.length; i++) {
    if (mach <= G1[i][0]) {
      const [m0, c0] = G1[i - 1];
      const [m1, c1] = G1[i];
      return c0 + ((c1 - c0) * (mach - m0)) / (m1 - m0);
    }
  }
  return G1[G1.length - 1][1];
}

/**
 * Fliegt das Geschoss mit Abgangswinkel angle (rad) bis maxM.
 * Gibt eine Funktion zurück, die zu einer Entfernung Höhe (m, relativ zur Laufachse-Startpunkt),
 * Geschwindigkeit und Flugzeit liefert.
 */
function fly(v0, bc, angle, maxM) {
  const k = (RHO * STD_AREA_PER_MASS) / (2 * bc);
  let x = 0, y = 0, t = 0;
  let vx = v0 * Math.cos(angle);
  let vy = v0 * Math.sin(angle);
  const dt = 0.0002;
  const pts = [{ x, y, v: v0, t }];
  while (x < maxM && t < 10) {
    const v = Math.hypot(vx, vy);
    const a = k * cdG1(v / SOUND) * v; // Verzögerung pro m/s Geschwindigkeit
    vx -= a * vx * dt;
    vy -= (a * vy + GRAVITY) * dt;
    x += vx * dt;
    y += vy * dt;
    t += dt;
    pts.push({ x, y, v: Math.hypot(vx, vy), t });
  }
  return (dist) => {
    // Lineare Interpolation zwischen den Integrationsschritten.
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].x < dist) lo = mid; else hi = mid;
    }
    const p = pts[lo], q = pts[hi];
    const f = q.x === p.x ? 0 : (dist - p.x) / (q.x - p.x);
    return { y: p.y + f * (q.y - p.y), v: p.v + f * (q.v - p.v), t: p.t + f * (q.t - p.t) };
  };
}

/**
 * Flugbahn relativ zur Visierlinie.
 * opts: v0 (m/s), bc (G1, lb/in²), sightHeightCm (Mitte Zielfernrohr über Laufmitte),
 *       zeroM (Fleckentfernung), massG (Geschossgewicht), distances (Liste in m).
 * Ergebnis pro Entfernung: heightCm (+ = Treffer über dem Haltepunkt), v (m/s), timeS, energyJ.
 */
export function trajectory({ v0, bc, sightHeightCm, zeroM, massG, distances }) {
  if (!(v0 > 0) || !(bc > 0) || !(zeroM > 0)) throw new Error("V0, BC und Fleckentfernung müssen größer als 0 sein.");
  const h = sightHeightCm / 100;
  const maxM = Math.max(zeroM, ...distances) + 1;
  // Abgangswinkel so suchen, dass das Geschoss auf zeroM die Visierlinie schneidet.
  let lo = -0.01, hi = 0.05;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const y = fly(v0, bc, mid, zeroM + 1)(zeroM).y - h;
    if (y > 0) hi = mid; else lo = mid;
  }
  const at = fly(v0, bc, (lo + hi) / 2, maxM);
  return distances.map((d) => {
    const p = at(d);
    // Visierlinie läuft waagerecht in Höhe h über der Laufachse am Start.
    return {
      distance: d,
      heightCm: (p.y - h) * 100,
      v: p.v,
      timeS: p.t,
      energyJ: massG > 0 ? 0.5 * (massG / 1000) * p.v * p.v : null,
    };
  });
}

/** Höhe des Treffpunkts über dem Haltepunkt (cm) auf einer Entfernung, bei Fleck auf zeroM. */
export function heightAt(opts, distanceM) {
  return trajectory({ ...opts, distances: [distanceM] })[0].heightCm;
}

/**
 * GEE (günstigste Einschießentfernung): Fleckentfernung, bei der die Flugbahn höchstens
 * maxRiseCm über die Visierlinie steigt. Gibt { zeroM, at100Cm } zurück oder null.
 */
export function geeZero(opts, maxRiseCm = 4) {
  const peak = (zeroM) => {
    const dists = [];
    for (let d = 10; d <= zeroM; d += 5) dists.push(d);
    return Math.max(...trajectory({ ...opts, zeroM, distances: dists }).map((r) => r.heightCm));
  };
  let lo = 50, hi = 400;
  try {
    if (peak(lo) > maxRiseCm || peak(hi) < maxRiseCm) return null;
  } catch {
    return null;
  }
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (peak(mid) > maxRiseCm) hi = mid; else lo = mid;
  }
  const zeroM = Math.floor(lo);
  return { zeroM, at100Cm: heightAt({ ...opts, zeroM }, 100) };
}
