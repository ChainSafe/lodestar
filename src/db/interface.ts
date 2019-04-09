import {EventEmitter} from "events";

import {
  Attestation,
  AttesterSlashing,
  BeaconBlock,
  BeaconState,
  bytes32,
  ProposerSlashing,
  Slot,
  VoluntaryExit,
  Transfer,
} from "../types";

export interface DBOptions {
  name?: string;
}

/**
 * The DB service manages the data layer of the beacon chain
 * The exposed methods do not refer to the underlying data engine, but instead expose relevent beacon chain objects
 */
export interface DB extends EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;

  /**
   * Get the beacon chain state
   * @returns {Promise<BeaconState>}
   */
  getState(): Promise<BeaconState>;

  /**
   * Set the beacon chain state
   * @param {BeaconState} state
   * @returns {Promise<void>}
   */
  setState(state: BeaconState): Promise<void>;

  /**
   * Get the last finalized state
   * @returns {Promise<BeaconState>}
   */
  getFinalizedState(): Promise<BeaconState>;

  /**
   * Set the last justified state
   * @param {BeaconState} state
   * @returns {Promise<void>}
   */
  setJustifiedState(state: BeaconState): Promise<void>;

  /**
   * Get the last justified state
   * @returns {Promise<BeaconState>}
   */
  getJustifiedState(): Promise<BeaconState>;

  /**
   * Set the last finalized state
   * @param {BeaconState} state
   * @returns {Promise<void>}
   */
  setFinalizedState(state: BeaconState): Promise<void>;

  /**
   * Get a block by block hash
   * @returns {Promise<BeaconBlock>}
   */
  getBlock(blockRoot: bytes32): Promise<BeaconBlock>;

  hasBlock(blockHash: bytes32): Promise<boolean>;

  /**
   * Get a block by slot
   * @returns {Promise<BeaconBlock>}
   */
  getBlockBySlot(slot: Slot): Promise<BeaconBlock>;

  /**
   * Put a block into the db
   * @param {BeaconBlock} block
   * @returns {Promise<void>}
   */
  setBlock(block: BeaconBlock): Promise<void>;

  /**
   * Get the latest finalized block
   * @returns {Promise<BeaconBlock>}
   */
  getFinalizedBlock(): Promise<BeaconBlock>;

  /**
   * Set the latest finalized block
   * @param {BeaconBlock} block
   * @returns {Promise<void>}
   */
  setFinalizedBlock(block: BeaconBlock): Promise<void>;

  /**
   * Get the latest justified block
   * @returns {Promise<BeaconBlock>}
   */
  getJustifiedBlock(): Promise<BeaconBlock>;

  /**
   * Set the latest justified block
   * @param {BeaconBlock} block
   * @returns {Promise<void>}
   */
  setJustifiedBlock(block: BeaconBlock): Promise<void>;

  /**
   * Get the head of the chain
   * @returns {Promise<BeaconBlock>}
   */
  getChainHead(): Promise<BeaconBlock>;

  /**
   * Get the root of the head of the chain
   * @returns {Promise<bytes32>}
   */
  getChainHeadRoot(): Promise<bytes32>;

  /**
   * Set the head of the chain
   * @param {BeaconState} state
   * @param {BeaconBlock} block
   * @returns {Promise<void>}
   */
  setChainHead(state: BeaconState, block: BeaconBlock): Promise<void>;

  /**
   * Fetch all attestations
   * @returns {Promise<Attestation[]>}
   */
  getAttestations(): Promise<Attestation[]>;

  /**
   * Put an attestation into the db
   * @param {Attestation} attestation
   * @returns {Promise<void>}
   */
  setAttestation(attestation: Attestation): Promise<void>;

  /**
   * Delete attestations from the db
   * @param {Attestation[]} attestations
   * @returns {Promise<void>}
   */
  deleteAttestations(attestations: Attestation[]): Promise<void>;

  /**
   * Fetch all voluntary exits
   * @returns {Promise<VoluntaryExit[]>}
   */
  getVoluntaryExits(): Promise<VoluntaryExit[]>;

  /**
   * Put a voluntary exit into the db
   * @param {VoluntaryExit} exit
   * @returns {Promise<void>}
   */
  setVoluntaryExit(exit: VoluntaryExit): Promise<void>;

  /**
   * Delete voluntary exits from the db
   * @param {VoluntaryExit[]} exits
   * @returns {Promise<void>}
   */
  deleteVoluntaryExits(exits: VoluntaryExit[]): Promise<void>;

  /**
   * Fetch all transfers
   * @returns {Promise<Transfer[]>}
   */
  getTransfers(): Promise<Transfer[]>;

  /**
   * Put a transfer into the db
   * @param {Transfer} transfer
   * @returns {Promise<void>}
   */
  setTransfer(transfer: Transfer): Promise<void>;

  /**
   * Delete transfers from the db
   * @param {Transfer[]} transfers
   * @returns {Promise<void>}
   */
  deleteTransfers(transfers: Transfer[]): Promise<void>;

  /**
   * Fetch all proposer slashings
   * @returns {Promise<ProposerSlashing[]>}
   */
  getProposerSlashings(): Promise<ProposerSlashing[]>;

  /**
   * Put a proposer slashing into the db
   * @param {ProposerSlashing} proposerSlashing
   * @returns {Promise<void>}
   */
  setProposerSlashing(proposerSlashing: ProposerSlashing): Promise<void>;

  /**
   * Delete attestations from the db
   * @param {ProposerSlashing[]} proposerSlashings
   * @returns {Promise<void>}
   */
  deleteProposerSlashings(proposerSlashings: ProposerSlashing[]): Promise<void>;

  /**
   * Fetch all attester slashings
   * @returns {Promise<AttesterSlashing[]>}
   */
  getAttesterSlashings(): Promise<AttesterSlashing[]>;

  /**
   * Put an attester slashing into the db
   * @param {AttesterSlashing} attesterSlashing
   * @returns {Promise<void>}
   */
  setAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<void>;

  /**
   * Delete attester slashings from the db
   * @param {AttesterSlashing[]} attesterSlashings
   * @returns {Promise<void>}
   */
  deleteAttesterSlashings(attesterSlashings: AttesterSlashing[]): Promise<void>;
}
