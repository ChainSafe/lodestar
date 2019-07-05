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
} from "@chainsafe/eth2-types";
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
  setDeposit(index: number, deposit: Deposit): Promise<void>;

  /**
   * Get all stored deposits sorted from oldest to newest.
   * It will only contain deposits until Eth2Genesis event.
   * After that, deposits will be kept in BeaconBlock
   */
  getDeposits(): Promise<Deposit[]>;

  /**
   * Deletes all deposits.
   */
  deleteDeposits(): Promise<void>;

  setMerkleTree(index: number, merkleTree: IProgressiveMerkleTree): Promise<void>;

  getMerkleTree(index: number): Promise<IProgressiveMerkleTree | null>;

  /**
   * Get a beacon chain state by hash
   */
  getState(root: bytes32): Promise<BeaconState | null>;

  /**
   * Set a beacon chain state
   */
  setState(root: bytes32, state: BeaconState): Promise<void>;

  /**
   * Get the latest beacon chain state
   */
  getLatestState(): Promise<BeaconState | null>;

  /**
   * Set the latest beacon chain state
   */
  setLatestStateRoot(root: bytes32, state?: BeaconState): Promise<void>;

  /**
   * Get the last finalized state
   */
  getFinalizedState(): Promise<BeaconState | null>;

  /**
   * Set the last finalized state
   */
  setFinalizedStateRoot(root: bytes32, state?: BeaconState): Promise<void>;

  /**
   * Get the last justified state
   */
  getJustifiedState(): Promise<BeaconState | null>;

  /**
   * Set the last justified state
   */
  setJustifiedStateRoot(root: bytes32, state?: BeaconState): Promise<void>;

  /**
   * Returns validator index coresponding to validator
   * public key in registry,
   * @param publicKey
   */
  getValidatorIndex(publicKey: BLSPubkey): Promise<ValidatorIndex | null>;

  /**
   * Get a block by block hash
   */
  getBlock(blockRoot: bytes32): Promise<BeaconBlock | null>;

  hasBlock(blockHash: bytes32): Promise<boolean>;

  /**
   * Get a block root by slot
   */
  getBlockRoot(slot: Slot): Promise<bytes32 | null>;

  /**
   * Get a block by slot
   */
  getBlockBySlot(slot: Slot): Promise<BeaconBlock | null>;

  /**
   * Put a block into the db
   */
  setBlock(root: bytes32, block: BeaconBlock): Promise<void>;

  /**
   * Get the latest finalized block
   */
  getFinalizedBlock(): Promise<BeaconBlock | null>;

  /**
   * Set the latest finalized block
   */
  setFinalizedBlockRoot(root: bytes32, block?: BeaconBlock): Promise<void>;

  /**
   * Get the latest justified block
   */
  getJustifiedBlock(): Promise<BeaconBlock | null>;

  /**
   * Set the latest justified block
   */
  setJustifiedBlockRoot(root: bytes32, block?: BeaconBlock): Promise<void>;

  /**
   * Get the slot of the head of the chain
   */
  getChainHeadSlot(): Promise<Slot | null>;

  /**
   * Get the root of the head of the chain
   */
  getChainHeadRoot(): Promise<bytes32 | null>;

  /**
   * Get the head of the chain
   */
  getChainHead(): Promise<BeaconBlock | null>;

  /**
   * Set the head of the chain
   */
  setChainHeadRoots(blockRoot: bytes32, stateRoot: bytes32, block?: BeaconBlock, state?: BeaconState): Promise<void>;

  /**
   * Fetch all attestations
   */
  getAttestations(): Promise<Attestation[]>;

  /**
   * Fetch an attestation by hash
   */
  getAttestation(attestationRoot: bytes32): Promise<Attestation | null>;


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
