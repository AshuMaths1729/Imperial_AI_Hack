import type { SimulationPayload, UIAnnotation, WorkspaceDataset } from "../../types/scholartwin";

/** Props every PaperSim tab receives from `PaperSimTabsView`. */
export interface PaperSimTabProps {
  dataset: WorkspaceDataset;
  /** Always present when a tab renders (the shell shows a loader otherwise). */
  simulation: SimulationPayload;
  paramValues: Record<string, number>;
  annotations: UIAnnotation[];
  /** Change one slider and re-run the simulation on the backend. */
  onParamChange: (key: string, val: number) => void;
  /** Set several sliders at once (presets / reset) and re-run. */
  onSetParams: (next: Record<string, number>) => void;
}
