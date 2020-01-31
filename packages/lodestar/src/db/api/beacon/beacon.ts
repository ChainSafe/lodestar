/**
 * @module db/api/beacon
 */

import {BeaconState, BLSPubkey, ValidatorIndex, Root, SignedBeaconBlock,} from "@chainsafe/eth2.0-types";
import {DatabaseService, IDatabaseApiOptions} from "../abstract";
import {IBeaconDb} from "./interface";
import {
  AggregateAndProofRepository,
  AttestationRepository,
  AttesterSlashingRepository,
  BlockRepository,
  ChainRepository,
  DepositRepository,
  MerkleTreeRepository,
  ProposerSlashingRepository,
  StateRepository,
  VoluntaryExitRepository
} from "./repositories";
import {BlockArchiveRepository} from "./repositories/blockArchive";

export class BeaconDb extends DatabaseService implements IBeaconDb {

  public chain: ChainRepository;

  public state: StateRepository;

  public block: BlockRepository;

  public blockArchive: BlockArchiveRepository;

  public attestation: AttestationRepository;

  public aggregateAndProof: AggregateAndProofRepository;

  public voluntaryExit: VoluntaryExitRepository;

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
    this.aggregateAndProof = new AggregateAndProofRepository(this.config, this.db);
    this.voluntaryExit = new VoluntaryExitRepository(this.config, this.db);
    this.proposerSlashing = new ProposerSlashingRepository(this.config, this.db);
    this.attesterSlashing = new AttesterSlashingRepository(this.config, this.db);
    this.deposit = new DepositRepository(this.config, this.db);
    this.merkleTree = new MerkleTreeRepository(this.config, this.db);
  }

  public async storeChainHead(
    signedBlock: SignedBeaconBlock,
    state: BeaconState
  ): Promise<void> {
    await Promise.all([
      this.block.add(signedBlock),
      this.state.set(signedBlock.message.stateRoot, state),
    ]);
    const slot = signedBlock.message.slot;
    await Promise.all([
      this.chain.setLatestStateRoot(signedBlock.message.stateRoot),
      this.chain.setChainHeadSlot(slot)
    ]);
  }

  public async updateChainHead(
    blockRoot: Root,
    stateRoot: Root
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
    const slot = storedBlock.message.slot;
    await Promise.all([
      this.chain.setLatestStateRoot(storedBlock.message.stateRoot),
      this.chain.setChainHeadSlot(slot)
    ]);
  }

  public async getValidatorIndex(publicKey: BLSPubkey): Promise<ValidatorIndex> {
    const state = await this.state.getLatest();
    //TODO: cache this (hashmap)
    return state.validators.findIndex(value => this.config.types.BLSPubkey.equals(value.pubkey, publicKey));
  }

}
