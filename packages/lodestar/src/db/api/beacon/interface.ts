/**
 * @module db/api/beacon
 */

import {
  BeaconBlock,
  BeaconState,
  BLSPubkey,
  Hash,
  ValidatorIndex,
} from "@chainsafe/eth2.0-types";

import {
  AttestationRepository,
  AttesterSlashingRepository,
  BlockRepository,
  ChainRepository,
  DepositRepository,
  MerkleTreeRepository,
  ProposerSlashingRepository,
  StateRepository,
  TransfersRepository,
  VoluntaryExitRepository
} from "./repositories";

/**
 * The DB service manages the data layer of the beacon chain
 * The exposed methods do not refer to the underlying data engine,
 * but instead expose relevent beacon chain objects
 */
export interface IBeaconDb {

  chain: ChainRepository;

  state: StateRepository;

  block: BlockRepository;

  attestation: AttestationRepository;

  voluntaryExit: VoluntaryExitRepository;

  transfer: TransfersRepository;

  proposerSlashing: ProposerSlashingRepository;

  attesterSlashing: AttesterSlashingRepository;

  deposit: DepositRepository;

  merkleTree: MerkleTreeRepository;

  /**
   * Returns validator index coresponding to validator
   * public key in registry,
   * @param publicKey
   */
  getValidatorIndex(publicKey: BLSPubkey): Promise<ValidatorIndex | null>;

  /**
   * Set the head of the chain
   */
  setChainHeadRoots(
    blockRoot: Hash,
    stateRoot: Hash,
    block?: BeaconBlock,
    state?: BeaconState
  ): Promise<void>;

}
