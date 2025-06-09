import {PeerId} from "@libp2p/interface";
import {BeaconConfig} from "@lodestar/config";
import {CustodyConfig} from "../util/dataColumns.js";
import {NodeId, computeNodeId} from "./subnets/interface.js";

/**
 * Store shared data for different modules in the network stack.
 * TODO: consider moving similar shared data, for example PeersData, under NetworkConfig.
 */
export class NetworkConfig {
  private readonly nodeId: NodeId;
  private readonly config: BeaconConfig;
  private readonly custodyConfig: CustodyConfig;

  constructor(peerId: PeerId, config: BeaconConfig) {
    this.nodeId = computeNodeId(peerId);
    this.config = config;
    this.custodyConfig = new CustodyConfig(this.nodeId, config, null);
  }

  getConfig(): BeaconConfig {
    return this.config;
  }

  getNodeId(): NodeId {
    return this.nodeId;
  }

  /**
   * Consumer should never mutate returned CustodyConfig
   */
  getCustodyConfig(): CustodyConfig {
    return this.custodyConfig;
  }

  setTargetGroupCount(count: number): void {
    this.custodyConfig.updateTargetCustodyGroupCount(count);
  }

  setAdvertisedGroupCount(count: number): void {
    this.custodyConfig.updateAdvertisedCustodyGroupCount(count);
  }
}
