import {EventEmitter} from "events";
import PeerId from "peer-id";
import StrictEventEmitter from "strict-event-emitter-types";
import {phase0} from "@chainsafe/lodestar-types";
import {Method} from "../constants";

export enum NetworkEvent {
  /** A relevant peer has connected or has been re-STATUS'd */
  peerConnected = "PeerManager-peerConnected",
  peerDisconnected = "PeerManager-peerDisconnected",
  gossipStart = "gossip-start",
  gossipStop = "gossip-stop",
  gossipHeartbeat = "gossipsub-heartbeat",
  reqRespRequest = "reqResp-request",
}

export type NetworkEvents = {
  [NetworkEvent.peerConnected]: (peer: PeerId, status: phase0.Status) => void;
  [NetworkEvent.peerDisconnected]: (peer: PeerId) => void;
  [NetworkEvent.reqRespRequest]: (method: Method, requestBody: phase0.RequestBody, peer: PeerId) => void;
};

export type INetworkEventBus = StrictEventEmitter<EventEmitter, NetworkEvents>;

export class NetworkEventBus extends (EventEmitter as {new (): INetworkEventBus}) {}
