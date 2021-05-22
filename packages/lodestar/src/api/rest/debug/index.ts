import {connectToPeer} from "./connectToPeer";
import {disconnectPeer} from "./disconnectPeer";
import {getDebugChainHeads} from "./getDebugChainHeads";
import {getState, getStateV2} from "./getStates";

export const debugRoutes = [connectToPeer, disconnectPeer, getDebugChainHeads, getState, getStateV2];
