/**
 * @module sync
 */

import PeerInfo from "peer-info";
import {
  Hash, Slot, number64,
  Hello, Goodbye, Status,
  BeaconBlock, BeaconState,
  RequestBody,
} from "@chainsafe/eth2.0-types";

import {
  Method, RequestId,
} from "../../constants";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ISyncOptions {
}

/**
 * The ISyncRpc module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export interface ISyncRpc {
  start: () => Promise<void>;

  stop: () => Promise<void>;

  refreshPeerHellos: () => Promise<void>;

  getHello: (peerInfo: PeerInfo) => Promise<Hello>;

  getGoodbye: (peerInfo: PeerInfo) => Promise<Goodbye>;

  getStatus: (peerInfo: PeerInfo) => Promise<Status>;

  getBeaconBlocks: (peerInfo: PeerInfo, startSlot: Slot, count: number64, backward: boolean) => Promise<BeaconBlock[]>;

  getBeaconStates: (peerInfo: PeerInfo, hashes: Hash[]) => Promise<BeaconState[]>;

  onRequest: (peerInfo: PeerInfo, method: Method, id: RequestId, body: RequestBody) => Promise<void>;
}
