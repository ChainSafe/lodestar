import {SyncingStatus} from "@chainsafe/lodestar-types";

import {NodeIdentity, NodePeer} from "../../types";

/**
 * Read information about the beacon node.
 */
export interface INodeApi {
  getNodeIdentity(): Promise<NodeIdentity>;
  getPeers(state?: string[], direction?: string[]): Promise<NodePeer[]>;
  getPeer(peerId: string): Promise<NodePeer | null>;
  /**
   * Gets the beacon node version.  Format of version string is derived from schema used by other
   * eth2 clients.
   * */
  getVersion(): Promise<string>;
  getSyncingStatus(): Promise<SyncingStatus>;
  getNodeStatus(): Promise<"ready" | "syncing" | "error">;
}
