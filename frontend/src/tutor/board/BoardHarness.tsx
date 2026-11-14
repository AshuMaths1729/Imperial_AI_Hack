"use client";

import { useRef, useState } from "react";
import valid from "../contracts/examples/valid_ops.json";
import type { BoardHandle, CircleEvent } from "../contracts/types";
import { makeBoardRpcHandlers } from "./rpc";
import { Whiteboard } from "./Whiteboard";

// Offline stand-in for the example's placeholder image URL.
const BALL = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#f1f5f9"/><path d="M20 60 Q160 260 300 60" fill="none" stroke="#64748b" stroke-width="4"/><circle cx="96" cy="128" r="18" fill="#ef4444"/></svg>`);
const ops = valid.ops.map((o) => ("url" in o ? { ...o, url: BALL } : o));
// Stop before the destructive tail (erase, clear) so the full board can be inspected; those run from buttons.
const demo = ops.filter((o) => o.op !== "erase" && o.op !== "clear_tutor_layer");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A stepped 5-line derivation under a question, then a mistake circled and corrected below (the showcase flow).
const derivation = [
  { op: "write_text", id: "q", text: "Minimise L(w) = (w - 3)^2 with gradient descent", place: "next" },
  { op: "write_math", id: "d1", latex: "L(w) = (w-3)^2", place: "next", group: "d", step: 1 },
  { op: "write_math", id: "d2", latex: "\\frac{dL}{dw} = 2(w-3)", place: "next", group: "d", step: 2 },
  { op: "write_math", id: "d3", latex: "w_{t+1} = w_t - \\eta \\cdot 2(w_t - 3)", place: "next", group: "d", step: 3 },
  { op: "write_math", id: "d4", latex: "w_0 = 0,\\ \\eta = 0.25 \\Rightarrow w_1 = 1.5", place: "next", group: "d", step: 4 },
  { op: "write_text", id: "d5", text: "Each step halves the distance to w = 3", place: "next", group: "d", step: 5 },
  { op: "reveal_step", group_id: "d", step: 1 },
];

/** Dev-only harness: plays the contract's example ops onto a Whiteboard, 500 ms apart. */
export function BoardHarness() {
  const board = useRef<BoardHandle>(null);
  const [log, setLog] = useState<string[]>([]);
  const [crop, setCrop] = useState<string>();
  const say = (line: string) => setLog((l) => [line, ...l].slice(0, 30));

  const playDerivation = async () => {
    say(`derivation → ${JSON.stringify(board.current?.applyOps(derivation))}`);
    for (let step = 2; step <= 5; step++) {
      await sleep(1800);
      run({ op: "reveal_step", group_id: "d", step });
    }
    await sleep(2000);
    run({ op: "point_at", target_id: "d3" });
    await sleep(1500);
    run([{ op: "annotate", id: "mark", mark: "circle", target_id: "d4" }, { op: "write_math", id: "fix", latex: "w_1 = 0 + 0.25 \\cdot 6 = 1.5\\ \\checkmark", place: "below:d5" }]);
  };

  const play = async () => {
    for (const op of demo) {
      say(`${op.op} → ${JSON.stringify(board.current?.applyOps([op]))}`);
      await sleep(500);
    }
  };
  const rpcSnapshot = async () => {
    const reply = await makeBoardRpcHandlers(() => board.current)["board.snapshot"]("{}");
    const r = JSON.parse(reply);
    say(`board.snapshot RPC → ${reply.length} bytes, ${r.mime ?? JSON.stringify(r.errors)}`);
    if (r.png_b64) setCrop(`data:${r.mime ?? "image/png"};base64,${r.png_b64}`);
  };
  const run = (op: object) => say(`${JSON.stringify(op)} → ${JSON.stringify(board.current?.applyOps(Array.isArray(op) ? op : [op]))}`);
  const onCircle = (e: CircleEvent) => {
    setCrop(`data:image/png;base64,${e.png_b64}`);
    say(`circle ${JSON.stringify({ ...e, png_b64: `${e.png_b64.length} chars` })}`);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", height: "100vh" }}>
      <Whiteboard ref={(h) => { board.current = h; (window as { board?: BoardHandle | null }).board = h; }} onCircle={onCircle} />
      <aside style={{ padding: 12, fontSize: 12, overflow: "auto", borderLeft: "1px solid #e5e7eb", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button onClick={play}>Play examples</button>
          <button onClick={playDerivation}>Derivation</button>
          <button onClick={() => run({ op: "highlight", target_id: "nope" })}>Bad op</button>
          <button onClick={() => run({ op: "erase", target_id: "line_sep" })}>Erase line</button>
          <button onClick={() => run({ op: "clear_tutor_layer" })}>Clear tutor</button>
          <button onClick={() => say(JSON.stringify(board.current?.describe()))}>Describe</button>
          <button onClick={async () => { const b = await board.current?.snapshot(); if (b) setCrop(`data:image/png;base64,${b}`); }}>Snapshot</button>
          <button onClick={rpcSnapshot}>Snapshot (RPC)</button>
          <button onClick={() => board.current?.setCircleMode(true)}>Circle to ask</button>
        </div>
        {crop && <img src={crop} alt="Last snapshot or circled crop" style={{ maxWidth: "100%", border: "1px solid #e5e7eb" }} />}
        <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{log.join("\n")}</pre>
      </aside>
    </div>
  );
}
