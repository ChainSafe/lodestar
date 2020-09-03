import {SyncingStatus} from "@chainsafe/lodestar-types";

import {NodeIdentity, NodePeer} from "../../types";

export interface INodeApi {
  getNodeIdentity(): Promise<NodeIdentity>;
  getPeers(): Promise<NodePeer[]>;
  getPeer(peerId: string): Promise<NodePeer | null>;
  getVersion(): Promise<string>;
  getSyncingStatus(): Promise<SyncingStatus>;
  getNodeStatus(): Promise<"ready" | "syncing" | "error">;
}
