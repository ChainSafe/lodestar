import {SinonStubbedInstance} from "sinon";
import {LevelDbController} from "@lodestar/db";

import {config as minimalConfig} from "@lodestar/config/default";
import {BeaconDb} from "../../../src/db/index.js";
import {
  AttesterSlashingRepository,
  BlockArchiveRepository,
  BlockRepository,
  DepositEventRepository,
  DepositDataRootRepository,
  Eth1DataRepository,
  ProposerSlashingRepository,
  StateArchiveRepository,
  VoluntaryExitRepository,
  BLSToExecutionChangeRepository,
  BlobsSidecarRepository,
  BlobsSidecarArchiveRepository,
} from "../../../src/db/repositories/index.js";
import {createStubInstance} from "../types.js";

export class StubbedBeaconDb extends BeaconDb {
  db!: SinonStubbedInstance<LevelDbController>;

  block: SinonStubbedInstance<BlockRepository> & BlockRepository;
  blockArchive: SinonStubbedInstance<BlockArchiveRepository> & BlockArchiveRepository;

  blobsSidecar: SinonStubbedInstance<BlobsSidecarRepository> & BlobsSidecarRepository;
  blobsSidecarArchive: SinonStubbedInstance<BlobsSidecarArchiveRepository> & BlobsSidecarArchiveRepository;

  stateArchive: SinonStubbedInstance<StateArchiveRepository> & StateArchiveRepository;

  voluntaryExit: SinonStubbedInstance<VoluntaryExitRepository> & VoluntaryExitRepository;
  blsToExecutionChange: SinonStubbedInstance<BLSToExecutionChangeRepository> & BLSToExecutionChangeRepository;
  proposerSlashing: SinonStubbedInstance<ProposerSlashingRepository> & ProposerSlashingRepository;
  attesterSlashing: SinonStubbedInstance<AttesterSlashingRepository> & AttesterSlashingRepository;
  depositEvent: SinonStubbedInstance<DepositEventRepository> & DepositEventRepository;

  depositDataRoot: SinonStubbedInstance<DepositDataRootRepository> & DepositDataRootRepository;
  eth1Data: SinonStubbedInstance<Eth1DataRepository> & Eth1DataRepository;

  constructor(config = minimalConfig) {
    // eslint-disable-next-line
    super({config, controller: {} as any});
    this.block = createStubInstance(BlockRepository);
    this.blockArchive = createStubInstance(BlockArchiveRepository);
    this.stateArchive = createStubInstance(StateArchiveRepository);

    this.voluntaryExit = createStubInstance(VoluntaryExitRepository);
    this.blsToExecutionChange = createStubInstance(BLSToExecutionChangeRepository);
    this.proposerSlashing = createStubInstance(ProposerSlashingRepository);
    this.attesterSlashing = createStubInstance(AttesterSlashingRepository);
    this.depositEvent = createStubInstance(DepositEventRepository);

    this.depositDataRoot = createStubInstance(DepositDataRootRepository);
    this.eth1Data = createStubInstance(Eth1DataRepository);
    this.blobsSidecar = createStubInstance(BlobsSidecarRepository);
    this.blobsSidecarArchive = createStubInstance(BlobsSidecarArchiveRepository);
  }
}
