import {SinonSandbox, SinonStubbedInstance} from "sinon";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";

import {BeaconDb, LevelDbController} from "../../../src/db";
import {
  AggregateAndProofRepository,
  AttestationRepository,
  AttesterSlashingRepository,
  BadBlockRepository,
  BlockArchiveRepository,
  BlockRepository,
  DepositLogRepository,
  DepositDataRootRepository,
  Eth1BlockHeaderRepository,
  Eth1DataDepositRepository,
  ProposerSlashingRepository,
  StateArchiveRepository,
  VoluntaryExitRepository,
} from "../../../src/db/api/beacon/repositories";
import {StateContextCache} from "../../../src/db/api/beacon/stateContextCache";
import {SeenAttestationCache} from "../../../src/db/api/beacon/seenAttestationCache";
import {CheckpointStateCache} from "../../../src/db/api/beacon/stateContextCheckpointsCache";
import {config as minimalConfig} from "@chainsafe/lodestar-config/lib/presets/minimal";

export class StubbedBeaconDb extends BeaconDb {
  public db!: SinonStubbedInstance<LevelDbController>;

  public badBlock: SinonStubbedInstance<BadBlockRepository> & BadBlockRepository;
  public block: SinonStubbedInstance<BlockRepository> & BlockRepository;
  public stateCache: SinonStubbedInstance<StateContextCache> & StateContextCache;
  public blockArchive: SinonStubbedInstance<BlockArchiveRepository> & BlockArchiveRepository;
  public stateArchive: SinonStubbedInstance<StateArchiveRepository> & StateArchiveRepository;

  public attestation: SinonStubbedInstance<AttestationRepository> & AttestationRepository;
  public aggregateAndProof: SinonStubbedInstance<AggregateAndProofRepository> & AggregateAndProofRepository;
  public voluntaryExit: SinonStubbedInstance<VoluntaryExitRepository> & VoluntaryExitRepository;
  public proposerSlashing: SinonStubbedInstance<ProposerSlashingRepository> & ProposerSlashingRepository;
  public attesterSlashing: SinonStubbedInstance<AttesterSlashingRepository> & AttesterSlashingRepository;
  public depositLog: SinonStubbedInstance<DepositLogRepository> & DepositLogRepository;

  public depositDataRoot: SinonStubbedInstance<DepositDataRootRepository> & DepositDataRootRepository;
  public eth1BlockHeader: SinonStubbedInstance<Eth1BlockHeaderRepository> & Eth1BlockHeaderRepository;
  public eth1DataDeposit: SinonStubbedInstance<Eth1DataDepositRepository> & Eth1DataDepositRepository;

  public checkpointStateCache: SinonStubbedInstance<CheckpointStateCache> & CheckpointStateCache;
  public seenAttestationCache: SinonStubbedInstance<SeenAttestationCache> & SeenAttestationCache;

  public processBlockOperations: SinonStubbedInstance<(signedBlock: SignedBeaconBlock) => Promise<void>> &
    ((signedBlock: SignedBeaconBlock) => Promise<void>);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(sinon: SinonSandbox, config = minimalConfig) {
    super({config, controller: null!});
    this.badBlock = sinon.createStubInstance(BadBlockRepository) as any;
    this.block = sinon.createStubInstance(BlockRepository) as any;
    this.stateCache = sinon.createStubInstance(StateContextCache) as any;
    this.blockArchive = sinon.createStubInstance(BlockArchiveRepository) as any;
    this.stateArchive = sinon.createStubInstance(StateArchiveRepository) as any;

    this.attestation = sinon.createStubInstance(AttestationRepository) as any;
    this.aggregateAndProof = sinon.createStubInstance(AggregateAndProofRepository) as any;
    this.voluntaryExit = sinon.createStubInstance(VoluntaryExitRepository) as any;
    this.proposerSlashing = sinon.createStubInstance(ProposerSlashingRepository) as any;
    this.attesterSlashing = sinon.createStubInstance(AttesterSlashingRepository) as any;
    this.depositLog = sinon.createStubInstance(DepositLogRepository) as any;

    this.depositDataRoot = sinon.createStubInstance(DepositDataRootRepository) as any;
    this.eth1BlockHeader = sinon.createStubInstance(Eth1BlockHeaderRepository) as any;
    this.eth1DataDeposit = sinon.createStubInstance(Eth1DataDepositRepository) as any;
    this.seenAttestationCache = sinon.createStubInstance(SeenAttestationCache) as any;
    this.checkpointStateCache = sinon.createStubInstance(CheckpointStateCache) as any;
    this.processBlockOperations = sinon.stub(this, "processBlockOperations") as any;
  }
}
