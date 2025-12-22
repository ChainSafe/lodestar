import {EventEmitter} from "node:events";
import {PeerId, TopicValidatorResult} from "@libp2p/interface";
import {CustodyIndex, Status} from "@lodestar/types";
import {PeerIdStr} from "../util/peerId.js";
import {StrictEventEmitterSingleArg} from "../util/strictEvents.js";
import {PendingGossipsubMessage} from "./processor/types.js";
import {RequestTypedContainer} from "./reqresp/ReqRespBeaconNode.js";

export enum NetworkEvent {
  /** A relevant peer has connected or has been re-STATUS'd */
  peerConnected = "peer-manager.peer-connected",
  /** A peer has been disconnected */
  peerDisconnected = "peer-manager.peer-disconnected",
  reqRespRequest = "req-resp.request",

  // Network processor events
  /** (Network -> App) A gossip message is ready for validation */
  pendingGossipsubMessage = "gossip.pendingGossipsubMessage",
  /** (App -> Network) A gossip message has been validated */
  gossipMessageValidationResult = "gossip.messageValidationResult",
}

export type NetworkEventData = {
  [NetworkEvent.peerConnected]: {
    peer: PeerIdStr;
    status: Status;
    custodyColumns: CustodyIndex[];
    clientAgent: string;
  };
  [NetworkEvent.peerDisconnected]: {peer: PeerIdStr};
  [NetworkEvent.reqRespRequest]: {request: RequestTypedContainer; peer: PeerId; peerClient: string};
  [NetworkEvent.pendingGossipsubMessage]: PendingGossipsubMessage;
  [NetworkEvent.gossipMessageValidationResult]: {
    msgId: string;
    propagationSource: PeerIdStr;
    acceptance: TopicValidatorResult;
  };
};

export enum EventDirection {
  workerToMain,
  mainToWorker,
  /** Event not emitted through worker boundary */
  none,
}

export const networkEventDirection: Record<NetworkEvent, EventDirection> = {
  [NetworkEvent.peerConnected]: EventDirection.workerToMain,
  [NetworkEvent.peerDisconnected]: EventDirection.workerToMain,
  [NetworkEvent.reqRespRequest]: EventDirection.none, // Only used internally in NetworkCore
  [NetworkEvent.pendingGossipsubMessage]: EventDirection.workerToMain,
  [NetworkEvent.gossipMessageValidationResult]: EventDirection.mainToWorker,
};

export type INetworkEventBus = StrictEventEmitterSingleArg<NetworkEventData>;

export class NetworkEventBus extends (EventEmitter as {new (): INetworkEventBus}) {}
