"use client";

import React, { useSyncExternalStore } from "react";
import type { WorkspaceMode } from "../../types/scholartwin";

/**
 * A small descriptive drawing for each module's Home card: what the module does, at a glance.
 * One ink, one paper and the module accents, all theme tokens, so the drawings follow light,
 * dark and high contrast. The few moving parts are SVG animations that are only rendered when
 * the user has not asked for reduced motion.
 *
 * (Styles are inline: next.config treats every *.css as global, so CSS modules don't apply.)
 */
const VIEWBOX = "0 0 320 160";

type Css = React.CSSProperties;
const INK: Css = { fill: "none", stroke: "var(--text-primary)", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
const FAINT: Css = { fill: "none", stroke: "var(--text-primary)", strokeOpacity: 0.3, strokeWidth: 1.4, strokeLinecap: "round" };
const LINE: Css = { fill: "var(--text-primary)", fillOpacity: 0.22 };
const LINE_STRONG: Css = { ...LINE, fillOpacity: 0.6 };
const CARD: Css = { fill: "var(--bg-surface-solid)", stroke: "var(--text-primary)", strokeOpacity: 0.22, strokeWidth: 1.2 };
const ink = (color: string, extra?: Css): Css => ({ ...INK, stroke: color, ...extra });
const card = (color: string): Css => ({ ...CARD, stroke: color, strokeOpacity: 1 });

const MONO = "var(--font-geist-mono), ui-monospace, monospace";
const SANS = "var(--font-geist), system-ui, sans-serif";

/* ---------- reduced motion ---------- */
const REDUCE = "(prefers-reduced-motion: reduce)";
function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia?.(REDUCE);
  mq?.addEventListener?.("change", cb);
  return () => mq?.removeEventListener?.("change", cb);
}
const motionOk = () => !(window.matchMedia?.(REDUCE).matches ?? false);
const noMotionOnServer = () => false;
function useMotion() {
  return useSyncExternalStore(subscribeMotion, motionOk, noMotionOnServer);
}

/** A looping, eased back-and-forth SVG animation. */
const LOOP = { repeatCount: "indefinite", calcMode: "spline", keyTimes: "0;0.5;1", keySplines: "0.45 0 0.55 1;0.45 0 0.55 1" } as const;

function LessonArt({ motion }: { motion: boolean }) {
  const wave = (d: string, begin: string) => (
    <path style={INK} d={d} opacity={motion ? 0.25 : 0.6}>
      {motion && <animate attributeName="opacity" values="0.25;0.9;0.25" dur="1.4s" begin={begin} {...LOOP} />}
    </path>
  );
  return (
    <svg className="block h-full w-full" viewBox={VIEWBOX} role="img" aria-label="A tutor on video explains a slide and circles part of it">
      {/* the tutor on a video tile, speaking */}
      <rect style={CARD} x="16" y="20" width="96" height="120" rx="16" />
      <circle cx="64" cy="66" r="17" style={{ fill: "var(--accent)", fillOpacity: 0.9 }} />
      <path d="M34 128 Q64 88 94 128 Z" style={{ fill: "var(--accent)", fillOpacity: 0.9 }} />
      <circle cx="30" cy="34" r="4" style={{ fill: "var(--status-contradict)" }} />
      {wave("M120 60 q6 8 0 16", "0s")}
      {wave("M127 54 q9 14 0 28", "0.25s")}
      {wave("M134 48 q12 20 0 40", "0.5s")}
      {/* the slide they are teaching from */}
      <rect style={CARD} x="150" y="22" width="154" height="96" rx="12" />
      <rect style={LINE_STRONG} x="164" y="36" width="70" height="7" rx="3.5" />
      <path style={FAINT} d="M168 104 V56 M168 104 H290" />
      <path style={ink("var(--status-link)", { strokeWidth: 2 })} d="M170 100 C 200 98, 230 86, 286 58" />
      <path style={ink("var(--status-contradict)")} d="M206 104 L 262 66" strokeDasharray="4 4" />
      <circle cx="236" cy="84" r="3.5" style={{ fill: "var(--status-contradict)" }} />
      {/* a hand-drawn whiteboard circle around the point being explained */}
      <path
        style={ink("var(--status-warning)", { strokeWidth: 2 })}
        d="M222 78 c 2 -12 26 -12 29 0 c 3 12 -22 17 -29 6 c -2 -4 0 -8 4 -10"
      />
      {/* lesson progress */}
      <rect style={LINE} x="150" y="130" width="154" height="5" rx="2.5" />
      <rect x="150" y="130" width="58" height="5" rx="2.5" style={{ fill: "var(--accent)" }} />
    </svg>
  );
}

function SimulatorArt({ motion }: { motion: boolean }) {
  return (
    <svg className="block h-full w-full" viewBox={VIEWBOX} role="img" aria-label="A paper's equation becomes a chart controlled by a slider">
      {/* the paper */}
      <path style={CARD} d="M18 18 H82 L100 36 V142 H18 Z" />
      <path style={FAINT} d="M82 18 V36 H100" />
      <rect style={LINE_STRONG} x="30" y="32" width="40" height="6" rx="3" />
      <rect style={LINE} x="30" y="48" width="58" height="4" rx="2" />
      <rect style={LINE} x="30" y="58" width="52" height="4" rx="2" />
      <rect x="28" y="72" width="62" height="24" rx="6" style={{ fill: "var(--status-support)", fillOpacity: 0.16 }} />
      <text x="34" y="88" style={{ fill: "var(--text-primary)", font: `500 10.5px ${MONO}` }}>
        R=e^-t/S
      </text>
      <rect style={LINE} x="30" y="106" width="58" height="4" rx="2" />
      <rect style={LINE} x="30" y="116" width="44" height="4" rx="2" />
      <rect style={LINE} x="30" y="126" width="54" height="4" rx="2" />
      {/* becomes */}
      <path style={ink("var(--accent)", { strokeWidth: 2 })} d="M108 82 H134 M127 75 L134 82 L127 89" />
      {/* a live chart */}
      <rect style={CARD} x="142" y="18" width="162" height="88" rx="12" />
      <path style={FAINT} d="M156 32 V94 H294" />
      <path style={ink("var(--status-contradict)")} d="M156 38 C 210 40, 236 84, 294 90" strokeDasharray="5 4" />
      <path style={ink("var(--status-support)", { strokeWidth: 2.4 })} d="M156 38 C 186 40, 206 74, 296 84">
        {motion && (
          <animate
            attributeName="d"
            values="M156 38 C 186 40, 206 74, 296 84;M156 38 C 196 38, 236 52, 296 60;M156 38 C 186 40, 206 74, 296 84"
            dur="5s"
            {...LOOP}
          />
        )}
      </path>
      {/* the slider that drives it */}
      <rect style={LINE} x="152" y="126" width="142" height="6" rx="3" />
      <rect x="152" y="126" width="71" height="6" rx="3" style={{ fill: "var(--status-support)" }}>
        {/* the fill follows the knob */}
        {motion && <animate attributeName="width" values="47;95;47" dur="5s" {...LOOP} />}
      </rect>
      <g transform="translate(-2 0)">
        {motion && <animateTransform attributeName="transform" type="translate" values="-26 0;22 0;-26 0" dur="5s" {...LOOP} />}
        <rect
          x="212"
          y="120"
          width="26"
          height="18"
          rx="9"
          style={{ fill: "var(--bg-surface-solid)", stroke: "var(--text-primary)", strokeOpacity: 0.35 }}
        />
      </g>
    </svg>
  );
}

function EvidenceArt() {
  return (
    <svg
      className="block h-full w-full"
      viewBox={VIEWBOX}
      role="img"
      aria-label="A question linked to papers that support it, one that contradicts it, and an open question"
    >
      {/* links: supports (solid), contradicts (thicker), open question (dashed) */}
      <path style={ink("var(--status-support)", { strokeWidth: 2 })} d="M160 80 Q 110 70 70 36" />
      <path style={ink("var(--status-support)", { strokeWidth: 2 })} d="M160 80 Q 210 70 252 36" />
      <path style={ink("var(--status-contradict)", { strokeWidth: 2.6 })} d="M160 80 Q 110 96 70 126" />
      <path style={ink("var(--status-gap)", { strokeWidth: 2 })} d="M160 80 Q 210 96 252 126" strokeDasharray="5 5" />
      {/* the question */}
      <rect x="116" y="64" width="88" height="32" rx="16" style={{ fill: "var(--text-primary)" }} />
      <text x="160" y="84" textAnchor="middle" style={{ fill: "var(--bg-surface-solid)", font: `500 11px ${SANS}` }}>
        your question
      </text>
      {/* supporting papers */}
      <rect style={card("var(--status-support)")} x="26" y="20" width="88" height="30" rx="15" />
      <path style={ink("var(--status-support)", { strokeWidth: 2 })} d="M40 35 l4 4 l8 -8" />
      <rect style={LINE} x="58" y="32" width="44" height="5" rx="2.5" />
      <rect style={card("var(--status-support)")} x="208" y="20" width="88" height="30" rx="15" />
      <path style={ink("var(--status-support)", { strokeWidth: 2 })} d="M222 35 l4 4 l8 -8" />
      <rect style={LINE} x="240" y="32" width="44" height="5" rx="2.5" />
      {/* a contradicting paper */}
      <rect style={card("var(--status-contradict)")} x="26" y="110" width="88" height="30" rx="15" />
      <path style={ink("var(--status-contradict)", { strokeWidth: 2 })} d="M40 120 l10 10 M50 120 l-10 10" />
      <rect style={LINE} x="58" y="122" width="44" height="5" rx="2.5" />
      {/* a question nobody has tested yet */}
      <rect style={card("var(--status-gap)")} x="208" y="110" width="88" height="30" rx="15" strokeDasharray="5 4" />
      <text x="222" y="130" style={{ fill: "var(--status-gap)", font: `600 14px ${SANS}` }}>
        ?
      </text>
      <rect style={LINE} x="240" y="122" width="44" height="5" rx="2.5" />
    </svg>
  );
}

export function ModuleArt({ module }: { module: WorkspaceMode }) {
  const motion = useMotion();
  if (module === "lecture") return <LessonArt motion={motion} />;
  if (module === "paper2sim") return <SimulatorArt motion={motion} />;
  return <EvidenceArt />;
}
