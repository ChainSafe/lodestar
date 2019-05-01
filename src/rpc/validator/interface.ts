/**
 * The API interface defines the calls that can be made from a Validator
 */
import {
  BeaconBlock, bytes, bytes32, bytes48, Fork, Shard, Slot, SyncingStatus, uint64,
  ValidatorDuty
} from "../../types";

export interface API {
  /**
   * Requests that the BeaconNode identify information about its implementation in a format similar to a HTTP User-Agent field.
   * @returns {Promise<bytes32>} An ASCII-encoded hex string which uniquely defines the implementation of the BeaconNode and its current software version.
   */
  getClientVersion(): Promise<bytes32>;

  /**
   * Requests the BeaconNode to provide which fork version it is currently on.
   * @returns {Promise<{fork: Fork; chain_id: uint64}>}
   */
  getFork(): Promise<{fork: Fork, chain_id: uint64}>;

  /**
   * Requests the genesis_time parameter from the BeaconNode, which should be consistent across all BeaconNodes that follow the same beacon chain.
   * @returns {Promise<uint64>} The genesis_time, which is a fairly static configuration option for the BeaconNode.
   */
  getGenesisTime(): Promise<uint64>;

  /**
   * Requests the BeaconNode to describe if it's currently syncing or not, and if it is, what block it is up to. This is modelled after the Eth1.0 JSON-RPC eth_syncing call.
   * @returns {Promise<boolean | SyncingStatus>} Either false if the node is not syncing, or a SyncingStatus object if it is.
   */
  getSyncingStatus(): Promise<boolean | SyncingStatus>;

  /**
   * Requests the BeaconNode to provide a set of “duties”, which are actions that should be performed by ValidatorClients. This API call should be polled at every slot, to ensure that any chain reorganisations are catered for, and to ensure that the currently connected BeaconNode is properly synchronised.
   * @param {bytes48[]} validator_pubkeys
   * @returns {Promise<{current_version: bytes4; validator_duties: ValidatorDuty[]}>} A list of unique validator public keys, where each item is a 0x encoded hex string.
   */
  getDuties(validator_pubkeys: bytes48[]): Promise<{current_version: Fork, validator_duties: ValidatorDuty[]}>;

  /**
   * Requests a BeaconNode to produce a valid block, which can then be signed by a ValidatorClient.
   * @param {Slot} slot
   * @param {bytes} randao_reveal
   * @returns {Promise<BeaconBlock>} A proposed BeaconBlock object, but with the signature field left blank.
   */
  produceBlock(slot: Slot, randao_reveal: bytes): Promise<BeaconBlock>;

  /**
   * Requests that the BeaconNode produce an IndexedAttestation, with a blank signature field, which the ValidatorClient will then sign.
   * @param {Slot} slot
   * @param {Shard} shard
   * @returns {Promise<IndexedAttestation>}
   */
  produceAttestation(slot: Slot, shard: Shard): Promise<IndexedAttestation>;

  /**
   * Instructs the BeaconNode to publish a newly signed beacon block to the beacon network, to be included in the beacon chain.
   * @param {BeaconBlock} beacon_block
   * @returns {Promise<void>}
   */
  publishBlock(beacon_block: BeaconBlock): Promise<void>;

  /**
   * Instructs the BeaconNode to publish a newly signed IndexedAttestation object, to be incorporated into the beacon chain.
   * @param {IndexedAttestation} indexed_attestation
   * @returns {Promise<void>}
   */
  publishAttestation(indexed_attestation: IndexedAttestation): Promise<void>;
}
