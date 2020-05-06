/**
 * @module db/api/beacon
 */

import {BeaconState, BLSPubkey, ValidatorIndex, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {DatabaseService, IDatabaseApiOptions} from "../abstract";
import {IBeaconDb} from "./interface";
import {
  AggregateAndProofRepository,
  AttestationRepository,
  AttesterSlashingRepository,
  BadBlockRepository,
  BlockRepository,
  BlockArchiveRepository,
  ChainRepository,
  DepositDataRepository,
  DepositDataRootRepository,
  Eth1DataRepository,
  ProposerSlashingRepository,
  StateRepository,
  VoluntaryExitRepository
} from "./repositories";

export class BeaconDb extends DatabaseService implements IBeaconDb {

  public chain: ChainRepository;
  public state: StateRepository;
  public badBlock: BadBlockRepository;
  public block: BlockRepository;
  public blockArchive: BlockArchiveRepository;

  public attestation: AttestationRepository;
  public aggregateAndProof: AggregateAndProofRepository;
  public voluntaryExit: VoluntaryExitRepository;
  public proposerSlashing: ProposerSlashingRepository;
  public attesterSlashing: AttesterSlashingRepository;
  public depositData: DepositDataRepository;

  public depositDataRoot: DepositDataRootRepository;
  public eth1Data: Eth1DataRepository;

  public constructor(opts: IDatabaseApiOptions) {
    super(opts);
    this.chain = new ChainRepository(this.config, this.db);
    this.state = new StateRepository(this.config, this.db, this.chain);
    this.badBlock = new BadBlockRepository(this.config, this.db);
    this.block = new BlockRepository(this.config, this.db, this.chain);
    this.blockArchive = new BlockArchiveRepository(this.config, this.db);
    this.attestation = new AttestationRepository(this.config, this.db);
    this.aggregateAndProof = new AggregateAndProofRepository(this.config, this.db);
    this.voluntaryExit = new VoluntaryExitRepository(this.config, this.db);
    this.proposerSlashing = new ProposerSlashingRepository(this.config, this.db);
    this.attesterSlashing = new AttesterSlashingRepository(this.config, this.db);
    this.depositData = new DepositDataRepository(this.config, this.db);
    this.depositDataRoot = new DepositDataRootRepository(this.config, this.db);
    this.eth1Data = new Eth1DataRepository(this.config, this.db);
  }

  public async storeChainHead(
    signedBlock: SignedBeaconBlock,
    state: BeaconState
  ): Promise<void> {
    await Promise.all([
      this.block.add(signedBlock),
      this.state.put(signedBlock.message.stateRoot.valueOf() as Uint8Array, state),
    ]);
    const slot = signedBlock.message.slot;
    await Promise.all([
      this.chain.setLatestStateRoot(signedBlock.message.stateRoot.valueOf() as Uint8Array),
      this.chain.setChainHeadSlot(slot)
    ]);
  }

  public async updateChainHead(
    blockRoot: Uint8Array,
    stateRoot: Uint8Array
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
      this.chain.setLatestStateRoot(storedBlock.message.stateRoot.valueOf() as Uint8Array),
      this.chain.setChainHeadSlot(slot)
    ]);
  }

  public async getValidatorIndex(publicKey: BLSPubkey): Promise<ValidatorIndex> {
    const state = await this.state.getLatest();
    //TODO: cache this (hashmap)
    return state.validators.findIndex(value => this.config.types.BLSPubkey.equals(value.pubkey, publicKey));
  }

  /**
   * Remove stored operations based on a newly processed block
   */
  public async processBlockOperations(signedBlock: SignedBeaconBlock): Promise<void> {
    await Promise.all([
      this.voluntaryExit.batchRemove(signedBlock.message.body.voluntaryExits),
      this.depositData.deleteOld(signedBlock.message.body.eth1Data.depositCount),
      this.proposerSlashing.batchRemove(signedBlock.message.body.proposerSlashings),
      this.attesterSlashing.batchRemove(signedBlock.message.body.attesterSlashings),
      this.aggregateAndProof.removeIncluded(signedBlock.message.body.attestations)
    ]);
  }
}
