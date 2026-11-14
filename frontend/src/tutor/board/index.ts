// Public API of the tutor whiteboard (WS2). Other workstreams import only from here.
export { Whiteboard } from "./Whiteboard";
export { makeBoardRpcHandlers } from "./rpc";
export { downscaleDims } from "./circle";
export type { ApplyResult, BoardDescription, BoardHandle, BoardItem, BoardOp, BoardRpcMethod, Box, CircleEvent } from "../contracts/types";
