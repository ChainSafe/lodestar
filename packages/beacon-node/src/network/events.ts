import {EventEmitter} from "node:events";
import {PeerId, TopicValidatorResult} from "@libp2p/interface";
import {RootHex, phase0} from "@lodestar/types";
import {BlockInput as BlockInputNew, BlockInputSyncSource} from "../chain/blocks/blockInput-mkeil/index.js";
import {BlockInput, NullBlockInput} from "../chain/blocks/types.js";
import {PeerIdStr} from "../util/peerId.js";
import {StrictEventEmitterSingleArg} from "../util/strictEvents.js";
import {EventDirection} from "../util/workerEvents.js";
import {PendingGossipsubMessage} from "./processor/types.js";
import {RequestTypedContainer} from "./reqresp/ReqRespBeaconNode.js";

export enum NetworkEvent {
  /** A relevant peer has connected or has been re-STATUS'd */
  peerConnected = "peer-manager.peer-connected",
  /** A peer has been disconnected */
  peerDisconnected = "peer-manager.peer-disconnected",
  reqRespRequest = "req-resp.request",
  // TODO remove this event, this is not a network-level concern, rather a chain / sync concern
  unknownBlockParent = "unknownBlockParent",
  unknownBlock = "unknownBlock",
  unknownBlockInput = "unknownBlockInput",

  // New BlockInput sync event trigger
  unknownBlockRoot = "unknownBlockRoot",
  blockInput = "blockInput",
  unknownParent = "unknownParent",

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
  // new block input events
  [NetworkEvent.unknownBlockRoot]: {rootHex: RootHex; peer?: PeerIdStr; source: BlockInputSyncSource};
  [NetworkEvent.blockInput]: {blockInput: BlockInputNew; peer: PeerIdStr; source: BlockInputSyncSource};
  [NetworkEvent.unknownParent]: {blockInput: BlockInputNew; peer: PeerIdStr; source: BlockInputSyncSource};
  // old unknownBlock blockInput events
  [NetworkEvent.unknownBlockParent]: {blockInput: BlockInput; peer: PeerIdStr};
  [NetworkEvent.unknownBlock]: {rootHex: RootHex; peer?: PeerIdStr};
  [NetworkEvent.unknownBlockInput]: {blockInput: BlockInput | NullBlockInput; peer?: PeerIdStr};

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
  [NetworkEvent.pendingGossipsubMessage]: EventDirection.workerToMain,
  [NetworkEvent.gossipMessageValidationResult]: EventDirection.mainToWorker,
  // new block input events
  [NetworkEvent.unknownBlockRoot]: EventDirection.workerToMain,
  [NetworkEvent.blockInput]: EventDirection.workerToMain,
  [NetworkEvent.unknownParent]: EventDirection.workerToMain,
  // old unknownBlock blockInput events
  [NetworkEvent.unknownBlockParent]: EventDirection.workerToMain,
  [NetworkEvent.unknownBlock]: EventDirection.workerToMain,
  [NetworkEvent.unknownBlockInput]: EventDirection.workerToMain,
};

export type INetworkEventBus = StrictEventEmitterSingleArg<NetworkEventData>;

export class NetworkEventBus extends (EventEmitter as {new (): INetworkEventBus}) {}
