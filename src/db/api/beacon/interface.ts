/**
 * @module db/api/beacon
 */

import {
  Attestation,
  AttesterSlashing,
  BeaconBlock,
  BeaconState, BLSPubkey,
  bytes32,
  Deposit, MerkleTree,
  ProposerSlashing,
  Slot,
  Transfer, ValidatorIndex,
  VoluntaryExit,
} from "../../../types";
import {IProgressiveMerkleTree} from "../../../util/merkleTree";

/**
 * The DB service manages the data layer of the beacon chain
 * The exposed methods do not refer to the underlying data engine,
 * but instead expose relevent beacon chain objects
 */
export interface IBeaconDb {

  /**
   * Adds deposit to database
   */
  setDeposit(deposit: Deposit): Promise<void>;

  /**
   * Get all stored deposits sorted from oldest to newest.
   * It will only contain deposits until Eth2Genesis event.
   * After that, deposits will be kept in BeaconBlock
   */
  getDeposits(): Promise<Deposit[]>;

  /**
   * Deletes all deposits.
   */
  deleteDeposits(deposits: Deposit[]): Promise<void>;

  setMerkleTree(merkleTree: IProgressiveMerkleTree): Promise<void>;

  getMerkleTree(): Promise<IProgressiveMerkleTree>;

  /**
   * Get the beacon chain state
   */
  getState(): Promise<BeaconState>;

  /**
   * Set the beacon chain state
   */
  setState(state: BeaconState): Promise<void>;

  /**
   * Returns validator index coresponding to validator
   * public key in registry,
   * @param publicKey
   */
  getValidatorIndex(publicKey: BLSPubkey): Promise<ValidatorIndex>;

  /**
   * Get the last finalized state
   */
  getFinalizedState(): Promise<BeaconState>;

  /**
   * Set the last justified state
   */
  setJustifiedState(state: BeaconState): Promise<void>;

  /**
   * Get the last justified state
   */
  getJustifiedState(): Promise<BeaconState>;

  /**
   * Set the last finalized state
   */
  setFinalizedState(state: BeaconState): Promise<void>;

  /**
   * Get a block by block hash
   */
  getBlock(blockRoot: bytes32): Promise<BeaconBlock>;

  hasBlock(blockHash: bytes32): Promise<boolean>;

  /**
   * Get a block root by slot
   */
  getBlockRoot(slot: Slot): Promise<bytes32>;

  /**
   * Get a block by slot
   */
  getBlockBySlot(slot: Slot): Promise<BeaconBlock>;

  /**
   * Put a block into the db
   */
  setBlock(block: BeaconBlock): Promise<void>;

  /**
   * Get the latest finalized block
   */
  getFinalizedBlock(): Promise<BeaconBlock>;

  /**
   * Set the latest finalized block
   */
  setFinalizedBlock(block: BeaconBlock): Promise<void>;

  /**
   * Get the latest justified block
   */
  getJustifiedBlock(): Promise<BeaconBlock>;

  /**
   * Set the latest justified block
   */
  setJustifiedBlock(block: BeaconBlock): Promise<void>;

  /**
   * Get the slot of the head of the chain
   */
  getChainHeadSlot(): Promise<Slot>;

  /**
   * Get the root of the head of the chain
   */
  getChainHeadRoot(): Promise<bytes32>;

  /**
   * Get the head of the chain
   */
  getChainHead(): Promise<BeaconBlock>;

  /**
   * Set the head of the chain
   */
  setChainHead(state: BeaconState, block: BeaconBlock): Promise<void>;

  /**
   * Fetch all attestations
   */
  getAttestations(): Promise<Attestation[]>;

  /**
   * Fetch an attestation by hash
   */
  getAttestation(attestationRoot: bytes32): Promise<Attestation>;


  hasAttestation(attestationRoot: bytes32): Promise<boolean>;

  /**
   * Put an attestation into the db
   */
  setAttestation(attestation: Attestation): Promise<void>;

  /**
   * Delete attestations from the db
   */
  deleteAttestations(attestations: Attestation[]): Promise<void>;

  /**
   * Fetch all voluntary exits
   */
  getVoluntaryExits(): Promise<VoluntaryExit[]>;

  /**
   * Put a voluntary exit into the db
   */
  setVoluntaryExit(exit: VoluntaryExit): Promise<void>;

  /**
   * Delete voluntary exits from the db
   */
  deleteVoluntaryExits(exits: VoluntaryExit[]): Promise<void>;

  /**
   * Fetch all transfers
   */
  getTransfers(): Promise<Transfer[]>;

  /**
   * Put a transfer into the db
   */
  setTransfer(transfer: Transfer): Promise<void>;

  /**
   * Delete transfers from the db
   */
  deleteTransfers(transfers: Transfer[]): Promise<void>;

  /**
   * Fetch all proposer slashings
   */
  getProposerSlashings(): Promise<ProposerSlashing[]>;

  /**
   * Put a proposer slashing into the db
   */
  setProposerSlashing(proposerSlashing: ProposerSlashing): Promise<void>;

  /**
   * Delete attestations from the db
   */
  deleteProposerSlashings(proposerSlashings: ProposerSlashing[]): Promise<void>;

  /**
   * Fetch all attester slashings
   */
  getAttesterSlashings(): Promise<AttesterSlashing[]>;

  /**
   * Put an attester slashing into the db
   */
  setAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<void>;

  /**
   * Delete attester slashings from the db
   */
  deleteAttesterSlashings(attesterSlashings: AttesterSlashing[]): Promise<void>;
}
