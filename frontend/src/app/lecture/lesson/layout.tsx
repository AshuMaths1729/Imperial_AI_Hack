import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./tutor.css";

export const metadata: Metadata = { title: "Live Tutor — ScholarTwin" };

// The workspace's type: Geist for text, Geist Mono for labels (see tutor.css).
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export default function TutorLayout({ children }: { children: React.ReactNode }) {
  return <div className={`contents ${geist.variable} ${geistMono.variable}`}>{children}</div>;
}
