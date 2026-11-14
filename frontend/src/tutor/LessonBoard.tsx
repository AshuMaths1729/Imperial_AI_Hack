"use client";

import { Tldraw } from "tldraw";
import "tldraw/tldraw.css";

// shortcut: a plain shared-by-nobody board; the tutor-driven board (WS2 Whiteboard + board.apply RPC) replaces it.
export default function LessonBoard() {
  return <Tldraw colorScheme="dark" />;
}
