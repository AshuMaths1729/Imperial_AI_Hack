// Public API of the Slides tab (WS-C). Other workstreams import only from here.
export { SlidesStage } from "./SlidesStage";
export { makeSlidesRpcHandlers, type SlidesRpcMethod, type StageHandle } from "./rpc";
export type { Deck, DeckView, Slide, SlidesHandle, StageTab } from "./types";
