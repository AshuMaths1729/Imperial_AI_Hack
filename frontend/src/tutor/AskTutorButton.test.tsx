import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GraphNodeData, SimulationPayload, WorkspaceDataset } from "@/types/scholartwin";
import * as api from "./shell/api";
import { AskTutorButton } from "./AskTutorButton";
import { lessonDataset, materialSource } from "./askTutor";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./shell/api", () => ({ listTracks: vi.fn(), createTrack: vi.fn(), addMaterial: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const node = (id: string, label: string, summary = ""): GraphNodeData => ({
  id, label, summary, category: "claim", mastery: 0, x: 0, y: 0, quiz: [],
});
const sim = (over: Partial<SimulationPayload> = {}): SimulationPayload => ({
  paper_title: "Heavy-ball momentum", arxiv_id: "", equation_latex: "x'' + \\gamma x' = -\\eta x", summary: "A damped oscillator.",
  python_code: "def simulate(): ...", params: [{ name: "Damping", key: "gamma", min_val: 0, max_val: 2, step: 0.1, default_val: 0.5, unit: "" }],
  x_label: "t", y_label: "x", x: [0, 1], series: [{ name: "x", color: "", y: [1, 0] }], ...over,
});
const paper: WorkspaceDataset = {
  mode: "paper2sim", title: "Heavy-ball momentum", subtitle: "", nodes: [], edges: [],
  simulation: sim({
    docs: {
      overview: "Momentum as a damped oscillator.",
      concepts: [
        { id: "momentum", label: "Momentum", kind: "concept", summary: "Velocity carries over between steps." },
        { id: "damping", label: "Damping", kind: "parameter", summary: "Friction on the ball." },
      ],
      links: [
        { source: "momentum", target: "damping", relation: "needs", kind: "prerequisite" },
        { source: "damping", target: "momentum", relation: "slows down", kind: "supports" },
      ],
    },
  }),
};
const evidence: WorkspaceDataset = {
  mode: "hypothesis", title: "Do garnets stop dendrites?", subtitle: "",
  nodes: [node("c1", "Garnets block dendrites", "High shear modulus."), node("c2", "Dendrites grow along grain boundaries")],
  edges: [{ id: "e1", source: "c2", target: "c1", type: "contradicts", condition: "above 0.5 mA/cm²" }],
};
const track = (track_id: string, title: string, materials: api.Material[] = []): api.Track => ({
  track_id, user_id: "demo", title, materials, knowledge_points: [], created_at: "",
});

const click = () => fireEvent.click(screen.getByRole("button", { name: /Ask a tutor about this/ }));

describe("AskTutorButton", () => {
  it("creates a track, adds the topic as material, then opens the lesson lobby on it", async () => {
    let tracks!: (t: api.Track[]) => void;
    vi.mocked(api.listTracks).mockReturnValue(new Promise((r) => (tracks = r)));
    vi.mocked(api.createTrack).mockResolvedValue(track("t9", "Heavy-ball momentum"));
    vi.mocked(api.addMaterial).mockResolvedValue(track("t9", "Heavy-ball momentum"));
    render(<AskTutorButton topic={{ title: "Heavy-ball momentum", dataset: paper, source: { kind: "url", ref: "https://arxiv.org/abs/1609.04747" } }} />);

    click();
    const busy = await screen.findByRole("button", { name: /Setting up your lesson/ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);

    await act(async () => tracks([track("t1", "Something else")]));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/lecture/lesson?track=t9"));
    expect(api.createTrack).toHaveBeenCalledWith("Heavy-ball momentum");
    const [id, material] = vi.mocked(api.addMaterial).mock.calls[0];
    expect(id).toBe("t9");
    expect(material.kind).toBe("url");
    expect(material.ref).toBe("https://arxiv.org/abs/1609.04747");
    expect(material.dataset.simulation).toBeNull(); // the graph only, not the sim payload
    expect(material.dataset.nodes.map((n) => n.label)).toEqual(["Momentum", "Damping"]);
  });

  it("reuses the track already made for this topic instead of creating another", async () => {
    const { ref } = materialSource({ title: evidence.title, dataset: evidence });
    vi.mocked(api.listTracks).mockResolvedValue([track("t3", evidence.title, [{ kind: "demo", ref, dataset_title: evidence.title }])]);
    render(<AskTutorButton topic={{ title: evidence.title, dataset: evidence }} />);

    click();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/lecture/lesson?track=t3"));
    expect(api.createTrack).not.toHaveBeenCalled();
    expect(api.addMaterial).not.toHaveBeenCalled();
  });

  it("fills an empty track left by a failed attempt rather than making a duplicate", async () => {
    vi.mocked(api.listTracks).mockResolvedValue([track("t4", evidence.title)]);
    vi.mocked(api.addMaterial).mockResolvedValue(track("t4", evidence.title));
    render(<AskTutorButton topic={{ title: evidence.title, dataset: evidence }} />);

    click();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/lecture/lesson?track=t4"));
    expect(api.createTrack).not.toHaveBeenCalled();
    expect(vi.mocked(api.addMaterial).mock.calls[0][0]).toBe("t4");
  });

  it("shows a readable error and lets the student try again", async () => {
    vi.mocked(api.listTracks).mockResolvedValue([]);
    vi.mocked(api.createTrack).mockResolvedValue(track("t5", evidence.title));
    vi.mocked(api.addMaterial).mockRejectedValue(Object.assign(new Error("HTTP 422"), { status: 422 }));
    render(<AskTutorButton topic={{ title: evidence.title, dataset: evidence }} />);

    click();
    expect((await screen.findByRole("alert")).textContent).toMatch(/didn't accept this topic/);
    expect(push).not.toHaveBeenCalled();

    vi.mocked(api.listTracks).mockRejectedValue(new TypeError("Failed to fetch"));
    click();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Couldn't reach the lesson service/));
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("lessonDataset", () => {
  it("turns a simulation's concept map into knowledge points, keeping prerequisites as edges", () => {
    const d = lessonDataset(paper);
    expect(d.nodes.map((n) => n.id)).toEqual(["momentum", "damping"]);
    expect(d.edges).toEqual([expect.objectContaining({ source: "momentum", target: "damping", type: "prerequisite" })]);
    expect(d.nodes[1].summary).toBe("Friction on the ball. slows down “Momentum”.");
  });

  it("falls back to the model and its parameters when the simulation has no concept map", () => {
    const d = lessonDataset({ ...paper, simulation: sim() });
    expect(d.nodes.map((n) => n.label)).toEqual(["Heavy-ball momentum", "Damping"]);
    expect(d.nodes[0].summary).toMatch(/A damped oscillator\. Key equation: /);
    expect(d.edges).toEqual([expect.objectContaining({ source: "model", target: "param-gamma" })]);
  });

  it("writes an evidence map's links into the claims, since the lesson keeps only prerequisites", () => {
    const d = lessonDataset(evidence);
    expect(d.nodes[1].summary).toBe("Contradicts “Garnets block dendrites” (above 0.5 mA/cm²).");
    expect(d.nodes[0].summary).toBe("High shear modulus.");
  });
});
