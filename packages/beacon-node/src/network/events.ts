import {EventEmitter} from "events";
import {PeerId} from "@libp2p/interface-peer-id";
import StrictEventEmitter from "strict-event-emitter-types";
import {TopicValidatorResult} from "@libp2p/interface-pubsub";
import {phase0} from "@lodestar/types";
import {BlockInput} from "../chain/blocks/types.js";
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

  // Network processor events
  /** (Network -> App) A gossip message is ready for validation */
  pendingGossipsubMessage = "gossip.pendingGossipsubMessage",
  /** (App -> Network) A gossip message has been validated */
  gossipMessageValidationResult = "gossip.messageValidationResult",
}

export type NetworkEvents = {
  [NetworkEvent.peerConnected]: (peer: PeerId, status: phase0.Status) => void;
  [NetworkEvent.peerDisconnected]: (peer: PeerId) => void;
  [NetworkEvent.reqRespRequest]: (request: RequestTypedContainer, peer: PeerId) => void;
  [NetworkEvent.unknownBlockParent]: (blockInput: BlockInput, peerIdStr: string) => void;
  [NetworkEvent.pendingGossipsubMessage]: (data: PendingGossipsubMessage) => void;
  [NetworkEvent.gossipMessageValidationResult]: (
    msgId: string,
    propagationSource: PeerId,
    acceptance: TopicValidatorResult
  ) => void;
};

export type INetworkEventBus = StrictEventEmitter<EventEmitter, NetworkEvents>;

export class NetworkEventBus extends (EventEmitter as {new (): INetworkEventBus}) {}
