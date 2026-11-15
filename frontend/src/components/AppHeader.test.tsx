import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FlaskConical, MessageSquarePlus } from "lucide-react";
import { AppHeader, HeaderAction } from "./AppHeader";

afterEach(cleanup);

describe("AppHeader", () => {
  it("shows the Athena mark when a screen has nothing else on the left (Home)", () => {
    render(<AppHeader sticky />);
    expect(screen.getByRole("banner").textContent).toContain("Athena");
    expect(screen.getByRole("group", { name: "Color theme" })).toBeTruthy();
  });

  it("keeps back, icon, title, subtitle and actions on module screens", () => {
    const onBack = vi.fn();
    const onAction = vi.fn();
    render(
      <AppHeader
        tone="support"
        back={{ label: "Home", onClick: onBack }}
        icon={FlaskConical}
        title="Paper Simulator"
        subtitle="Your papers"
        actions={<HeaderAction icon={MessageSquarePlus} label="Open a paper" tone="support" onClick={onAction} />}
      />
    );
    expect(screen.getByRole("heading", { level: 1, name: "Paper Simulator" })).toBeTruthy();
    expect(screen.getByText("Your papers")).toBeTruthy();
    expect(screen.getByRole("banner").textContent).not.toContain("Athena");
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(onBack).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open a paper" }));
    expect(onAction).toHaveBeenCalled();
  });

  it("renders a link back when given an href, and pressed state on active actions", () => {
    render(
      <AppHeader
        back={{ label: "Home", href: "/" }}
        title="Live Lessons"
        actions={<HeaderAction icon={MessageSquarePlus} label="Captions" active onClick={vi.fn()} />}
      />
    );
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("button", { name: "Captions" }).getAttribute("aria-pressed")).toBe("true");
  });
});
