import {BeaconConfig} from "@lodestar/config";
import {CustodyConfig} from "../util/dataColumns.js";
import {NodeId} from "./subnets/interface.js";

/**
 * Store shared data for different modules in the network stack.
 */
export type NetworkConfig = {
  readonly nodeId: NodeId;
  readonly config: BeaconConfig;
  readonly custodyConfig: CustodyConfig;
  /** Enable cell-level DAS via gossipsub partial messages extension */
  readonly enablePartialColumns: boolean;
  /** When publishing partial columns, eagerly include all cells (not just header) */
  readonly eagerlyPublishCells: boolean;
};
