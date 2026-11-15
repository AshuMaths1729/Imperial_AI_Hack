import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UploadModal } from "./UploadModal";

afterEach(cleanup);

const props = () => ({ loading: false, error: null, onClose: vi.fn(), onUploadPdf: vi.fn(), onIngestUrl: vi.fn() });

describe("Open a paper dialog", () => {
  it("renders nothing when closed", () => {
    render(<UploadModal open={false} {...props()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is titled Open a paper and closes with the button or Escape", () => {
    const p = props();
    render(<UploadModal open {...p} />);
    expect(screen.getByRole("dialog", { name: "Open a paper" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });

  it("submits an arXiv ID, but not while a paper is loading", () => {
    const p = props();
    const { rerender } = render(<UploadModal open {...p} />);
    const input = screen.getByRole("textbox", { name: "arXiv URL or ID" });
    fireEvent.change(input, { target: { value: "1706.03762" } });
    fireEvent.submit(input.closest("form")!);
    expect(p.onIngestUrl).toHaveBeenCalledWith("1706.03762");

    rerender(<UploadModal open {...p} loading />);
    fireEvent.submit(input.closest("form")!);
    expect(p.onIngestUrl).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("Reading the paper");
  });

  it("opens the file picker from the keyboard and uploads the chosen PDF", () => {
    const p = props();
    const { container } = render(<UploadModal open {...p} />);
    const fileInput = container.querySelector("input[type=file]") as HTMLInputElement;
    const click = vi.spyOn(fileInput, "click");
    fireEvent.keyDown(screen.getByRole("button", { name: /Drop a PDF here/ }), { key: "Enter" });
    expect(click).toHaveBeenCalled();
    const file = new File(["%PDF"], "a.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(p.onUploadPdf).toHaveBeenCalledWith(file);
  });
});
