/**
 * @module db/api/beacon
 */

import {BLSPubkey, ValidatorIndex, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {DatabaseService, IDatabaseApiOptions} from "../abstract";
import {IBeaconDb} from "./interface";
import {
  AggregateAndProofRepository,
  AttestationRepository,
  AttesterSlashingRepository,
  BadBlockRepository,
  BlockRepository,
  BlockArchiveRepository,
  DepositDataRepository,
  DepositDataRootRepository,
  Eth1DataRepository,
  ProposerSlashingRepository,
  StateArchiveRepository,
  VoluntaryExitRepository
} from "./repositories";
import {StateCache} from "./stateCache";
import {encodeKey, Bucket} from "../schema";
import {bytesToInt, intToBytes} from "@chainsafe/lodestar-utils";

export class BeaconDb extends DatabaseService implements IBeaconDb {

  public badBlock: BadBlockRepository;
  public block: BlockRepository;
  public stateCache: StateCache;
  public blockArchive: BlockArchiveRepository;
  public stateArchive: StateArchiveRepository;

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
    this.badBlock = new BadBlockRepository(this.config, this.db);
    this.block = new BlockRepository(this.config, this.db);
    this.stateCache = new StateCache();
    this.blockArchive = new BlockArchiveRepository(this.config, this.db);
    this.stateArchive = new StateArchiveRepository(this.config, this.db);
    this.attestation = new AttestationRepository(this.config, this.db);
    this.aggregateAndProof = new AggregateAndProofRepository(this.config, this.db);
    this.voluntaryExit = new VoluntaryExitRepository(this.config, this.db);
    this.proposerSlashing = new ProposerSlashingRepository(this.config, this.db);
    this.attesterSlashing = new AttesterSlashingRepository(this.config, this.db);
    this.depositData = new DepositDataRepository(this.config, this.db);
    this.depositDataRoot = new DepositDataRootRepository(this.config, this.db);
    this.eth1Data = new Eth1DataRepository(this.config, this.db);
  }

  public async getValidatorIndex(publicKey: BLSPubkey): Promise<ValidatorIndex> {
    const state = await this.stateArchive.lastValue();
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

  public async stop(): Promise<void> {
    await super.stop();
    this.stateCache.clear();
  }

  // TODO: small e2e to make sure it works
  public async getLastProcessedEth1BlockNumber(): Promise<number> {
    const data = await this.db.get(
      encodeKey(Bucket.chainInfo, "lastProcessedBlockNumber")
    );
    if(!data) {
      return undefined;
    }
    return bytesToInt(data);
  }

  public async setLastProcessedEth1BlockNumber(eth1BlockNumber: number): Promise<void> {
    const data = intToBytes(eth1BlockNumber, 32);
    return this.db.put(encodeKey(Bucket.chainInfo, "lastProcessedBlockNumber"), data);
  }
}
