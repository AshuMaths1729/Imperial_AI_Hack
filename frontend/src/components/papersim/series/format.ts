/** Number / label formatting shared by the Results and Equations tabs. */

const SUPERSCRIPT: Record<string, string> = {
  "-": "⁻",
  "+": "",
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

const MINUS = "−";

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/**
 * Human-friendly number with `sig` significant figures. Very large / tiny magnitudes switch to
 * scientific notation (1.2×10⁻⁴); everything else gets thousands separators and a true minus sign.
 */
export function fmtNum(v: number | null | undefined, sig = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) {
    const [mant, exp] = v.toExponential(Math.max(0, sig - 1)).split("e");
    const sup = exp
      .split("")
      .map((c) => SUPERSCRIPT[c] ?? c)
      .join("");
    return `${trimZeros(mant).replace("-", MINUS)}×10${sup}`;
  }
  const digits = Math.min(6, Math.max(0, sig - 1 - Math.floor(Math.log10(a))));
  const s = v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  if (/^-0(\.0*)?$/.test(s)) return "0";
  return s.replace("-", MINUS);
}

/** Signed number: "+0.31" / "−0.31" / "0". */
export function fmtSigned(v: number | null | undefined, sig = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = fmtNum(v, sig);
  if (s === "0") return "0";
  return v > 0 ? `+${s}` : s;
}

/** Fraction -> signed percentage, e.g. -0.6912 -> "−69.1%". */
export function fmtPct(frac: number | null | undefined, sig = 3): string {
  if (frac === null || frac === undefined || !Number.isFinite(frac)) return "—";
  return `${fmtSigned(frac * 100, sig)}%`;
}

export interface AxisLabel {
  /** e.g. "Time" from "Time (days)" */
  name: string;
  /** e.g. "days" from "Time (days)"; "" when none */
  unit: string;
}

/** Split "Time t (days)" / "Retention [%]" into name + unit. */
export function parseAxisLabel(label: string | undefined | null): AxisLabel {
  const raw = (label ?? "").trim();
  const m = raw.match(/^(.*?)\s*[([]\s*([^)\]]+?)\s*[)\]]\s*$/);
  if (m && m[1]) return { name: m[1].trim(), unit: m[2].trim() };
  return { name: raw || "x", unit: "" };
}

/** "t = 30 days" style phrase for an x position. */
export function atX(axis: AxisLabel, x: number): string {
  return `${axis.name} = ${fmtNum(x)}${axis.unit ? ` ${axis.unit}` : ""}`;
}

/** Value + optional unit. */
export function withUnit(v: string, unit: string): string {
  return unit ? `${v} ${unit}` : v;
}

/** Filesystem-friendly slug for downloads. */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "simulation"
  );
}
