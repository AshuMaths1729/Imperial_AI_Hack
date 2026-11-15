"use client";

import React from "react";
import { PaperSimCanvas } from "../PaperSimCanvas";
import type { PaperSimTabProps } from "./types";

/** "Simulate" tab. Keyed by sim so pins / trace / hidden series reset per paper. */
export function SimulationTab({ simulation, paramValues, annotations, onParamChange, onSetParams }: PaperSimTabProps) {
  return (
    <PaperSimCanvas
      key={simulation.sim_id ?? simulation.arxiv_id ?? simulation.paper_title}
      simulation={simulation}
      paramValues={paramValues}
      annotations={annotations}
      onParamChange={onParamChange}
      onSetParams={onSetParams}
    />
  );
}
