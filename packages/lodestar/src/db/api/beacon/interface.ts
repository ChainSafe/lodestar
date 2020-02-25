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
  DepositDataRootListRepository,
  ProposerSlashingRepository,
  StateRepository,
  VoluntaryExitRepository,
  AggregateAndProofRepository
} from "./repositories";
import {BlockArchiveRepository} from "./repositories/blockArchive";

/**
 * The DB service manages the data layer of the beacon chain
 * The exposed methods do not refer to the underlying data engine,
 * but instead expose relevent beacon chain objects
 */
export interface IBeaconDb {

  chain: ChainRepository;

  state: StateRepository;

  block: BlockRepository;

  blockArchive: BlockArchiveRepository;

  attestation: AttestationRepository;

  aggregateAndProof: AggregateAndProofRepository;

  voluntaryExit: VoluntaryExitRepository;

  proposerSlashing: ProposerSlashingRepository;

  attesterSlashing: AttesterSlashingRepository;

  depositData: DepositDataRepository;

  depositDataRootList: DepositDataRootListRepository;
  /**
   * Returns validator index coresponding to validator
   * public key in registry,
   * @param publicKey
   */
  getValidatorIndex(publicKey: BLSPubkey): Promise<ValidatorIndex | null>;

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
