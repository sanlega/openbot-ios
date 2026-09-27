export const PACKAGE_NAME = "@openbot/ui";

export { createTransport, HttpTransport } from "./transport/index.js";
export type { Transport, TransportMode, TransportOptions } from "./transport/index.js";

export { MockClientApiServer, SEED_BOTS, buildSeedEvents } from "./mock/index.js";

export { uiReducer, createInitialState, pendingApprovals, heldMessages } from "./state/reducer.js";
export type { UiState, UiAction } from "./state/reducer.js";

export { OpenBotProvider, useOpenBot, useLocalTransport } from "./state/context.js";

export { OpenBotApp, DevApp } from "./app/App.js";
export { AppShell } from "./components/layout/AppShell.js";
export { RouteChip } from "./components/thread/RouteChip.js";
export { ApprovalCard } from "./components/cards/ApprovalCard.js";
export { EventCard, allEventTypesLabeled } from "./components/cards/EventCard.js";

export type * from "./api/types.js";
