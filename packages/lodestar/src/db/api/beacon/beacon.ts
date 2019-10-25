/**
 * @module db/api/beacon
 */

import {BeaconBlock, BeaconState, BLSPubkey, Hash, ValidatorIndex,} from "@chainsafe/eth2.0-types";
import {DatabaseService, IDatabaseApiOptions} from "../abstract";
import {IBeaconDb} from "./interface";
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
import {BlockArchiveRepository} from "./repositories/blockArhive";

export class BeaconDb extends DatabaseService implements IBeaconDb {

  public chain: ChainRepository;

  public state: StateRepository;

  public block: BlockRepository;

  public blockArchive: BlockArchiveRepository;

  public attestation: AttestationRepository;

  public voluntaryExit: VoluntaryExitRepository;

  public transfer: TransfersRepository;

  public proposerSlashing: ProposerSlashingRepository;

  public attesterSlashing: AttesterSlashingRepository;

  public deposit: DepositRepository;

  public merkleTree: MerkleTreeRepository;

  public constructor(opts: IDatabaseApiOptions) {
    super(opts);
    this.chain = new ChainRepository(this.config, this.db);
    this.state = new StateRepository(this.config, this.db, this.chain);
    this.block = new BlockRepository(this.config, this.db, this.chain);
    this.blockArchive = new BlockArchiveRepository(this.config, this.db);
    this.attestation = new AttestationRepository(this.config, this.db);
    this.voluntaryExit = new VoluntaryExitRepository(this.config, this.db);
    this.transfer = new TransfersRepository(this.config, this.db);
    this.proposerSlashing = new ProposerSlashingRepository(this.config, this.db);
    this.attesterSlashing = new AttesterSlashingRepository(this.config, this.db);
    this.deposit = new DepositRepository(this.config, this.db);
    this.merkleTree = new MerkleTreeRepository(this.config, this.db);
  }

  public async setChainHead(
    block: BeaconBlock,
    state: BeaconState
  ): Promise<void> {
    await Promise.all([
      this.block.setUnderRoot(block),
      this.state.set(block.stateRoot, state),
    ]);
    const slot = block.slot;
    await Promise.all([
      this.chain.setLatestStateRoot(block.stateRoot),
      this.chain.setChainHeadSlot(slot)
    ]);
  }

  public async updateChainHead(
    blockRoot: Hash,
    stateRoot: Hash
  ): Promise<void> {
    const [storedBlock, storedState] = await Promise.all([
      this.block.get(blockRoot),
      this.state.get(stateRoot),
    ]);
    // block should already be set
    if(!storedBlock) {
      throw new Error("unknown block root");
    }
    // state should already be set
    if(!storedState) {
      throw new Error("unknown state root");
    }
    const slot = storedBlock.slot;
    await Promise.all([
      this.chain.setLatestStateRoot(storedBlock.stateRoot),
      this.chain.setChainHeadSlot(slot)
    ]);
  }



  public async getValidatorIndex(publicKey: BLSPubkey): Promise<ValidatorIndex> {
    const state = await this.state.getLatest();
    //TODO: cache this (hashmap)
    return state.validators.findIndex(value => value.pubkey.equals(publicKey));
  }

}