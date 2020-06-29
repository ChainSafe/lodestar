import {SinonSandbox, SinonStubbedInstance} from "sinon";

import {config as mainnetConfig} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";

import {BeaconDb, LevelDbController} from "../../../src/db";
import {
  AttesterSlashingRepository,
  AggregateAndProofRepository,
  AttestationRepository,
  BadBlockRepository,
  BlockRepository,
  BlockArchiveRepository,
  DepositDataRepository,
  DepositDataRootRepository,
  ProposerSlashingRepository,
  VoluntaryExitRepository,
  Eth1DataRepository,
  StateArchiveRepository,
} from "../../../src/db/api/beacon/repositories";
import {StateCache} from "../../../src/db/api/beacon/stateCache";

export class StubbedBeaconDb extends BeaconDb {
  public db: SinonStubbedInstance<LevelDbController>;

  public badBlock: SinonStubbedInstance<BadBlockRepository> & BadBlockRepository;
  public block: SinonStubbedInstance<BlockRepository> & BlockRepository;
  public stateCache: SinonStubbedInstance<StateCache> & StateCache;
  public blockArchive: SinonStubbedInstance<BlockArchiveRepository> & BlockArchiveRepository;
  public stateArchive: SinonStubbedInstance<StateArchiveRepository> & StateArchiveRepository;

  public attestation: SinonStubbedInstance<AttestationRepository> & AttestationRepository;
  public aggregateAndProof: SinonStubbedInstance<AggregateAndProofRepository> & AggregateAndProofRepository;
  public voluntaryExit: SinonStubbedInstance<VoluntaryExitRepository> & VoluntaryExitRepository;
  public proposerSlashing: SinonStubbedInstance<ProposerSlashingRepository> & ProposerSlashingRepository;
  public attesterSlashing: SinonStubbedInstance<AttesterSlashingRepository> & AttesterSlashingRepository;
  public depositData: SinonStubbedInstance<DepositDataRepository> & DepositDataRepository;

  public depositDataRoot: SinonStubbedInstance<DepositDataRootRepository> & DepositDataRootRepository;
  public eth1Data: SinonStubbedInstance<Eth1DataRepository> & Eth1DataRepository;


  public processBlockOperations:
  SinonStubbedInstance<(signedBlock: SignedBeaconBlock) => Promise<void>>
  &
  ((signedBlock: SignedBeaconBlock) => Promise<void>);

  constructor(sinon: SinonSandbox, config = mainnetConfig) {
    super({
      config,
      controller: sinon.createStubInstance(LevelDbController),
    });
    this.badBlock = sinon.createStubInstance(BadBlockRepository) as any;
    this.block = sinon.createStubInstance(BlockRepository) as any;
    this.stateCache = sinon.createStubInstance(StateCache) as any;
    this.blockArchive = sinon.createStubInstance(BlockArchiveRepository) as any;
    this.stateArchive = sinon.createStubInstance(StateArchiveRepository) as any;

    this.attestation = sinon.createStubInstance(AttestationRepository) as any;
    this.aggregateAndProof = sinon.createStubInstance(AggregateAndProofRepository) as any;
    this.voluntaryExit = sinon.createStubInstance(VoluntaryExitRepository) as any;
    this.proposerSlashing = sinon.createStubInstance(ProposerSlashingRepository) as any;
    this.attesterSlashing = sinon.createStubInstance(AttesterSlashingRepository) as any;
    this.depositData = sinon.createStubInstance(DepositDataRepository) as any;

    this.depositDataRoot = sinon.createStubInstance(DepositDataRootRepository) as any;
    this.eth1Data = sinon.createStubInstance(Eth1DataRepository) as any;

    this.processBlockOperations = sinon.stub(this, "processBlockOperations") as any;
  }
}
