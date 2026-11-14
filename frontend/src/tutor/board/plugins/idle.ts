import type { BoardPlugin } from "../../contracts/types";

/** Watches the student's ink and emits a "tutor.idle" IdleEvent after they stop writing. Built in WS-B. */
export const idlePlugin: BoardPlugin = () => {};
