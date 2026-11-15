"use client";

import { Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import { useTheme } from "@/components/ThemeProvider";

// shortcut: a plain shared-by-nobody board; the tutor-driven board (WS2 Whiteboard + board.apply RPC) replaces it.
export default function LessonBoard() {
  const { theme } = useTheme();
  // Follow the app theme (tldraw has no high-contrast scheme; its dark one is closest).
  return <Tldraw colorScheme={theme === "light" ? "light" : "dark"} />;
}
