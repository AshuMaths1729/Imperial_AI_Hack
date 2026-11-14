import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScholarTwin — Spatial AI Research & Learning Workspace",
  description: "Interactive concept graphs, live paper simulations, and cross-paper contradiction maps.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}
