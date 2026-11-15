/**
 * Painted landscapes for the Meadow Glass backdrop. Pure canvas drawing (no React), so the
 * same painter can be reused or tested. Three layers are painted once per size/theme/kind and
 * blurred by CSS (depth of field); only the drifting pollen is animated.
 */

export type SceneKind = "meadow" | "hills" | "lake";

type Palette = {
  sky: [string, string, string];
  hills: string[];
  bokeh: string[];
  grass: string;
  sun: string;
  water?: [string, string];
};

const PALETTES: Record<SceneKind, { day: Palette; dusk: Palette }> = {
  meadow: {
    day: { sky: ["#d3ddbb", "#a9bb86", "#62743f"], hills: ["#8ea36a", "#6b7f45", "#4c5e2c"], bokeh: ["#ffffff", "#f6f1d6", "#fff7c2"], grass: "#3d4f22", sun: "rgba(255,250,224,.75)" },
    dusk: { sky: ["#2a3324", "#1d2618", "#11170c"], hills: ["#2f3b22", "#26311b", "#1a2312"], bokeh: ["#f3e6b8", "#e8d79a", "#ffffff"], grass: "#0f160a", sun: "rgba(240,200,140,.35)" },
  },
  hills: {
    day: { sky: ["#dfe5cf", "#c4cfa7", "#a6b57f"], hills: ["#b2c08d", "#8b9d5d", "#6c7f3e"], bokeh: ["#ffffff", "#eef3d8", "#ffffff"], grass: "#55682c", sun: "rgba(255,255,236,.8)" },
    dusk: { sky: ["#2b3226", "#20271b", "#151a10"], hills: ["#343f26", "#29331d", "#1d2614"], bokeh: ["#d9cfa6", "#f0e6c2", "#c7d3a0"], grass: "#11180b", sun: "rgba(230,190,130,.3)" },
  },
  lake: {
    day: { sky: ["#d3ded4", "#b4c6b7", "#8fa695"], hills: ["#7f9a7f", "#5f7b62", "#4a6450"], bokeh: ["#ffffff", "#e8f2ec", "#fff6d8"], grass: "#3b4d2a", sun: "rgba(255,252,230,.8)", water: ["#9fb7ad", "#6f8d86"] },
    dusk: { sky: ["#232c2a", "#192120", "#0f1514"], hills: ["#28362f", "#1f2b25", "#16201b"], bokeh: ["#e9dcae", "#c9d8cf", "#ffffff"], grass: "#0d140c", sun: "rgba(220,190,140,.3)", water: ["#2a3a37", "#18231f"] },
  },
};

const SEEDS: Record<SceneKind, number> = { meadow: 7, hills: 11, lake: 23 };

/** Small deterministic PRNG, so a scene looks the same on every load. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function prep(c: HTMLCanvasElement, w: number, h: number, dpr: number) {
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const x = c.getContext("2d");
  if (!x) return null;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  return x;
}

export function paintScene(
  kind: SceneKind,
  dark: boolean,
  layers: { far: HTMLCanvasElement; bokeh: HTMLCanvasElement; front: HTMLCanvasElement },
  w: number,
  h: number,
  dpr: number
) {
  const p = PALETTES[kind][dark ? "dusk" : "day"];
  const R = rng(SEEDS[kind]);

  // far: sky, sun, hills (and water for the lake)
  let x = prep(layers.far, w, h, dpr);
  if (!x) return;
  let g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, p.sky[0]);
  g.addColorStop(0.55, p.sky[1]);
  g.addColorStop(1, p.sky[2]);
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  g = x.createRadialGradient(w * 0.72, h * 0.18, 0, w * 0.72, h * 0.18, Math.max(w, h) * 0.55);
  g.addColorStop(0, p.sun);
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  const horizon = kind === "lake" ? 0.46 : kind === "hills" ? 0.5 : 0.56;
  p.hills.forEach((col, i) => {
    const base = h * (horizon + i * 0.09);
    const amp = h * (kind === "hills" ? 0.11 : 0.05) * (1 - i * 0.15);
    const ph = R() * 6;
    const f = (kind === "hills" ? 1.4 : 2.4) + i * 0.6;
    x!.beginPath();
    x!.moveTo(0, h);
    for (let X = 0; X <= w; X += 8) {
      x!.lineTo(X, base - Math.sin((X / w) * f * Math.PI + ph) * amp - Math.sin((X / w) * f * 2.7 + ph * 2) * amp * 0.35);
    }
    x!.lineTo(w, h);
    x!.closePath();
    x!.fillStyle = col;
    x!.globalAlpha = 0.9;
    x!.fill();
    x!.globalAlpha = 1;
  });
  if (p.water) {
    const top = h * (horizon + 0.12);
    g = x.createLinearGradient(0, top, 0, h);
    g.addColorStop(0, p.water[0]);
    g.addColorStop(1, p.water[1]);
    x.fillStyle = g;
    x.fillRect(0, top, w, h - top);
    x.strokeStyle = dark ? "rgba(255,255,255,.10)" : "rgba(255,255,255,.45)";
    x.lineWidth = 1.2;
    for (let i = 0; i < 70; i++) {
      const yy = top + Math.pow(R(), 1.6) * (h - top);
      const xx = R() * w;
      const len = 20 + R() * 120;
      x.globalAlpha = 0.3 + R() * 0.5;
      x.beginPath();
      x.moveTo(xx, yy);
      x.lineTo(xx + len, yy);
      x.stroke();
    }
    x.globalAlpha = 1;
  }

  // bokeh: out-of-focus blossoms and sun sparkles
  x = prep(layers.bokeh, w, h, dpr);
  if (!x) return;
  const n = kind === "meadow" ? 46 : 26;
  for (let i = 0; i < n; i++) {
    const cx = R() * w;
    const cy = h * (0.35 + R() * 0.65);
    const r = (kind === "meadow" ? 10 : 6) + R() * (kind === "meadow" ? 46 : 30);
    const col = p.bokeh[Math.floor(R() * p.bokeh.length)];
    x.globalAlpha = (dark ? 0.25 : 0.55) + R() * 0.35;
    if (kind === "meadow" && R() > 0.35) {
      // a daisy: petals around a warm centre
      x.fillStyle = col;
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        x.beginPath();
        x.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55 * 0.7, r * 0.42, r * 0.18, a, 0, Math.PI * 2);
        x.fill();
      }
      x.fillStyle = dark ? "#b89a3e" : "#e7c64e";
      x.beginPath();
      x.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
      x.fill();
    } else {
      x.fillStyle = col;
      x.beginPath();
      x.arc(cx, cy, r, 0, Math.PI * 2);
      x.fill();
    }
  }
  x.globalAlpha = 1;

  // front: grass and reeds, close to the lens
  x = prep(layers.front, w, h, dpr);
  if (!x) return;
  const blades = kind === "lake" ? 60 : 140;
  for (let i = 0; i < blades; i++) {
    const bx = R() * w;
    const bh = h * (0.12 + R() * (kind === "lake" ? 0.5 : 0.32));
    const lean = (R() - 0.5) * bh * 0.5;
    x.strokeStyle = p.grass;
    x.globalAlpha = 0.55 + R() * 0.45;
    x.lineWidth = 1.5 + R() * (kind === "lake" ? 3.5 : 2.5);
    x.lineCap = "round";
    x.beginPath();
    x.moveTo(bx, h + 4);
    x.quadraticCurveTo(bx + lean * 0.2, h - bh * 0.6, bx + lean, h - bh);
    x.stroke();
    if (kind === "lake" && R() > 0.7) {
      x.fillStyle = p.grass;
      x.beginPath();
      x.ellipse(bx + lean, h - bh, 3, 12, lean / bh, 0, Math.PI * 2);
      x.fill();
    }
  }
  x.globalAlpha = 1;
}

export type Mote = { x: number; y: number; r: number; v: number; p: number };

export function makeMotes(w: number, h: number, count = 34): Mote[] {
  const R = rng(99);
  return Array.from({ length: count }, () => ({ x: R() * w, y: R() * h, r: 0.8 + R() * 2.2, v: 0.15 + R() * 0.4, p: R() * 6 }));
}

/** Drifting pollen: rises slowly and sways; `t` is a rAF timestamp in ms. */
export function drawMotes(c: HTMLCanvasElement, motes: Mote[], w: number, h: number, t: number, dark: boolean) {
  const x = c.getContext("2d");
  if (!x) return;
  x.clearRect(0, 0, w, h);
  x.fillStyle = dark ? "rgba(255,236,170,.55)" : "rgba(255,255,240,.85)";
  for (const d of motes) {
    const yy = (d.y - t * d.v * 0.02) % h;
    const y = yy < 0 ? yy + h : yy;
    const xx = d.x + Math.sin(t / 1400 + d.p) * 18;
    x.globalAlpha = 0.4 + 0.4 * Math.sin(t / 900 + d.p * 3) ** 2;
    x.beginPath();
    x.arc(xx, y, d.r, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
}
