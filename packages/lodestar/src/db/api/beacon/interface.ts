/**
 * @module db/api/beacon
 */

import {
  BLSPubkey,
  ValidatorIndex,
  SignedBeaconBlock,
} from "@chainsafe/lodestar-types";

import {
  AttestationRepository,
  AttesterSlashingRepository,
  BlockRepository,
  DepositDataRepository,
  DepositDataRootRepository,
  ProposerSlashingRepository,
  StateArchiveRepository,
  VoluntaryExitRepository,
  AggregateAndProofRepository,
  BlockArchiveRepository,
  BadBlockRepository,
  Eth1DataRepository,
} from "./repositories";
import {StateCache} from "./stateCache";

/**
 * The DB service manages the data layer of the beacon chain
 * The exposed methods do not refer to the underlying data engine,
 * but instead expose relevent beacon chain objects
 */
export interface IBeaconDb {

  // bad blocks
  badBlock: BadBlockRepository;

  // unfinalized blocks
  block: BlockRepository;

  // unfinalized states
  stateCache: StateCache;

  // finalized blocks
  blockArchive: BlockArchiveRepository;

  // finalized states
  stateArchive: StateArchiveRepository;

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

  getLastProcessedEth1BlockNumber(): Promise<number>;

  setLastProcessedEth1BlockNumber(eth1BlockNumber: number): Promise<void>;
}
