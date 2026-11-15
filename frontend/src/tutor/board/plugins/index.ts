import type { BoardPlugin } from "../../contracts/types";
import { idlePlugin } from "./idle";

/** Board plugins the live lesson mounts. Each workstream owns its own plugin file. */
export const BOARD_PLUGINS: BoardPlugin[] = [idlePlugin];
