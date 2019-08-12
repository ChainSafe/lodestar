/**
 * @module api/rpc
 */

import {IApi} from "../../../interface";
import {BeaconBlock, BeaconState, bytes32, Fork, number64, SyncingStatus} from "@chainsafe/eth2.0-types";

export interface IBeaconApi extends IApi {

  /**
   * Requests that the BeaconNode identify information about its
   * implementation in a format similar to a HTTP User-Agent field.
   * @returns An ASCII-encoded hex string which
   * uniquely defines the implementation of the BeaconNode and its current software version.
   */
  getClientVersion(): Promise<bytes32>;

  /**
   * Requests the BeaconNode to provide which fork version it is currently on.
   */
  getFork(): Promise<Fork>;

  /**
   * Requests the genesis_time parameter from the BeaconNode,
   * which should be consistent across all BeaconNodes that follow the same beacon chain.
   * @returns The genesis_time,
   * which is a fairly static configuration option for the BeaconNode.
   */
  getGenesisTime(): Promise<number64>;

  /**
   * Requests the BeaconNode to describe if it's currently syncing or not,
   * and if it is, what block it is up to.
   * This is modelled after the Eth1.0 JSON-RPC eth_syncing call.
   * @returns Either false if the node is not syncing,
   * or a SyncingStatus object if it is.
   */
  getSyncingStatus(): Promise<boolean | SyncingStatus>;

  /**
   * Return the current chain head
   */
  getChainHead(): Promise<BeaconBlock>;

  /**
   * Returns latest beacon state
   */
  getBeaconState(): Promise<BeaconState>;

}
