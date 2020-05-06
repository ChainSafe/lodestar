/**
 * @module db/api/beacon
 */

import {
  BeaconState,
  BLSPubkey,
  ValidatorIndex,
  SignedBeaconBlock,
} from "@chainsafe/lodestar-types";

import {
  AttestationRepository,
  AttesterSlashingRepository,
  BlockRepository,
  ChainRepository,
  DepositDataRepository,
  DepositDataRootRepository,
  ProposerSlashingRepository,
  StateRepository,
  VoluntaryExitRepository,
  AggregateAndProofRepository,
  BlockArchiveRepository,
  BadBlockRepository,
  Eth1DataRepository,
} from "./repositories";

/**
 * The DB service manages the data layer of the beacon chain
 * The exposed methods do not refer to the underlying data engine,
 * but instead expose relevent beacon chain objects
 */
export interface IBeaconDb {

  chain: ChainRepository;

  // states
  state: StateRepository;

  // bad blocks
  badBlock: BadBlockRepository;

  // unfinalized blocks
  block: BlockRepository;

  // finalized blocks
  blockArchive: BlockArchiveRepository;

  // op pool
  attestation: AttestationRepository;
  aggregateAndProof: AggregateAndProofRepository;
  voluntaryExit: VoluntaryExitRepository;
  proposerSlashing: ProposerSlashingRepository;
  attesterSlashing: AttesterSlashingRepository;
  depositData: DepositDataRepository;

  // eth1 processing

  // all deposit data roots and merkle tree
  depositDataRoot: DepositDataRootRepository;
  eth1Data: Eth1DataRepository;
  /**
   * Returns validator index coresponding to validator
   * public key in registry,
   * @param publicKey
   */
  getValidatorIndex(publicKey: BLSPubkey): Promise<ValidatorIndex | null>;

  processBlockOperations(signedBlock: SignedBeaconBlock): Promise<void>;

  /**
   * Stores block and state and set them as chain head
   */
  storeChainHead(
    block: SignedBeaconBlock,
    state: BeaconState
  ): Promise<void>;

  /**
   * Fetches block and state by root and sets them as chain head
   * @param blockRoot
   * @param stateRoot
   */
  updateChainHead(
    blockRoot: Uint8Array,
    stateRoot: Uint8Array
  ): Promise<void>;
}
