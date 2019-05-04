/**
 * The API interface defines the calls that can be made from a Validator
 */
import {
  Attestation, AttestationData,
  BeaconBlock, bytes, bytes32, bytes48, Epoch, Fork, IndexedAttestation, number64, Shard, Slot, SyncingStatus, uint64,
  ValidatorDuty, ValidatorIndex
} from "../../../types/index";
import {IApi} from "../interface";
import {CommitteeAssignment} from "../../../validator/types";

export interface IValidatorApi extends IApi {
  /**
   * Requests that the BeaconNode identify information about its implementation in a format similar to a HTTP User-Agent field.
   * @returns {Promise<bytes32>} An ASCII-encoded hex string which uniquely defines the implementation of the BeaconNode and its current software version.
   */
  getClientVersion(): Promise<bytes32>;

  /**
   * Requests the BeaconNode to provide which fork version it is currently on.
   * @returns {Promise<{fork: Fork; chainId: uint64}>}
   */
  getFork(): Promise<Fork>;

  /**
   * Requests the genesis_time parameter from the BeaconNode, which should be consistent across all BeaconNodes that follow the same beacon chain.
   * @returns {Promise<uint64>} The genesis_time, which is a fairly static configuration option for the BeaconNode.
   */
  getGenesisTime(): Promise<number64>;

  /**
   * Requests the BeaconNode to describe if it's currently syncing or not, and if it is, what block it is up to. This is modelled after the Eth1.0 JSON-RPC eth_syncing call.
   * @returns {Promise<boolean | SyncingStatus>} Either false if the node is not syncing, or a SyncingStatus object if it is.
   */
  getSyncingStatus(): Promise<boolean | SyncingStatus>;

  /**
   * Requests the BeaconNode to provide a set of “duties”, which are actions that should be performed by ValidatorClients. This API call should be polled at every slot, to ensure that any chain reorganisations are catered for, and to ensure that the currently connected BeaconNode is properly synchronised.
   * @param {bytes48[]} validatorPubkey
   * @returns {Promise<{currentVersion: bytes4; validatorDuty: ValidatorDuty}>} A list of unique validator public keys, where each item is a 0x encoded hex string.
   */
  getDuties(validatorPubkey: bytes48): Promise<{currentVersion: Fork; validatorDuty: ValidatorDuty}>;

  /**
   * Requests to check if a validator should propose for a given slot.
   * @param {bytes48} validatorPubkey
   * @param {Slot} slot
   * @returns {Promise<{slot: Slot, proposer: boolean}}
   */
  isProposer(index: ValidatorIndex, slot: Slot): Promise<boolean>;

  /**
   * Requests a validators committeeAssignment, can be used for past, current and one epoch in the future
   * @param {ValidatorIndex} index
   * @param {Epoch} epoch
   */
  getCommitteeAssignment(index: ValidatorIndex, epoch: Epoch): Promise<CommitteeAssignment>;

  /**
   * Requests a BeaconNode to produce a valid block, which can then be signed by a ValidatorClient.
   * @param {Slot} slot
   * @param {bytes} randaoReveal
   * @returns {Promise<BeaconBlock>} A proposed BeaconBlock object, but with the signature field left blank.
   */
  produceBlock(slot: Slot, randaoReveal: bytes): Promise<BeaconBlock>;

  /**
   * Requests that the BeaconNode produce an IndexedAttestation, with a blank signature field, which the ValidatorClient will then sign.
   * @param {Slot} slot
   * @param {Shard} shard
   * @returns {Promise<Attestation>}
   */
  produceAttestation(slot: Slot, shard: Shard): Promise<AttestationData>;

  /**
   * Instructs the BeaconNode to publish a newly signed beacon block to the beacon network, to be included in the beacon chain.
   * @param {BeaconBlock} beaconBlock
   * @returns {Promise<void>}
   */
  publishBlock(beaconBlock: BeaconBlock): Promise<void>;

  /**
   * Instructs the BeaconNode to publish a newly signed IndexedAttestation object, to be incorporated into the beacon chain.
   * @param {Attestation} attestation
   * @returns {Promise<void>}
   */
  publishAttestation(attestation: Attestation): Promise<void>;
}
