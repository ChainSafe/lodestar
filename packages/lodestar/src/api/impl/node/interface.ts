import {IApi} from "../../interface";
import {NodeIdentity, NodePeer} from "../../types";
import {SyncingStatus} from "@chainsafe/lodestar-types";

export interface INodeApi extends IApi {
  getNodeIdentity(): Promise<NodeIdentity>;
  getPeers(): Promise<NodePeer[]>;
  getPeer(peerId: string): Promise<NodePeer|null>;
  getVersion(): Promise<string>;
  getSyncingStatus(): Promise<SyncingStatus>;
  getNodeStatus(): Promise<"ready"|"syncing"|"error">;
}
