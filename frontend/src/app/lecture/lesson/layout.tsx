import type { Metadata } from "next";

export const metadata: Metadata = { title: "Live Lessons — Athena" };

export default function LessonLayout({ children }: { children: React.ReactNode }) {
  return children;
}
