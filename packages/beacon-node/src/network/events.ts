import {EventEmitter} from "events";
import {PeerId} from "@libp2p/interface-peer-id";
import {TopicValidatorResult} from "@libp2p/interface-pubsub";
import {phase0, RootHex} from "@lodestar/types";
import {BlockInput} from "../chain/blocks/types.js";
import {StrictEventEmitterSingleArg} from "../util/strictEvents.js";
import {PeerIdStr} from "../util/peerId.js";
import {EventDirection} from "../util/workerEvents.js";
import {RequestTypedContainer} from "./reqresp/ReqRespBeaconNode.js";
import {PendingGossipsubMessage} from "./processor/types.js";

export enum NetworkEvent {
  /** A relevant peer has connected or has been re-STATUS'd */
  peerConnected = "peer-manager.peer-connected",
  /** A peer has been disconnected */
  peerDisconnected = "peer-manager.peer-disconnected",
  reqRespRequest = "req-resp.request",
  // TODO remove this event, this is not a network-level concern, rather a chain / sync concern
  unknownBlockParent = "unknownBlockParent",
  unknownBlock = "unknownBlock",

  // Network processor events
  /** (Network -> App) A gossip message is ready for validation */
  pendingGossipsubMessage = "gossip.pendingGossipsubMessage",
  /** (App -> Network) A gossip message has been validated */
  gossipMessageValidationResult = "gossip.messageValidationResult",
}

export type NetworkEventData = {
  [NetworkEvent.peerConnected]: {peer: PeerIdStr; status: phase0.Status};
  [NetworkEvent.peerDisconnected]: {peer: PeerIdStr};
  [NetworkEvent.reqRespRequest]: {request: RequestTypedContainer; peer: PeerId};
  [NetworkEvent.unknownBlockParent]: {blockInput: BlockInput; peer: PeerIdStr};
  [NetworkEvent.unknownBlock]: {rootHex: RootHex; peer?: PeerIdStr};
  [NetworkEvent.pendingGossipsubMessage]: PendingGossipsubMessage;
  [NetworkEvent.gossipMessageValidationResult]: {
    msgId: string;
    propagationSource: PeerIdStr;
    acceptance: TopicValidatorResult;
  };
};

export const networkEventDirection: Record<NetworkEvent, EventDirection> = {
  [NetworkEvent.peerConnected]: EventDirection.workerToMain,
  [NetworkEvent.peerDisconnected]: EventDirection.workerToMain,
  [NetworkEvent.reqRespRequest]: EventDirection.none, // Only used internally in NetworkCore
  [NetworkEvent.unknownBlockParent]: EventDirection.workerToMain,
  [NetworkEvent.unknownBlock]: EventDirection.workerToMain,
  [NetworkEvent.pendingGossipsubMessage]: EventDirection.workerToMain,
  [NetworkEvent.gossipMessageValidationResult]: EventDirection.mainToWorker,
};

export type INetworkEventBus = StrictEventEmitterSingleArg<NetworkEventData>;

export class NetworkEventBus extends (EventEmitter as {new (): INetworkEventBus}) {}
