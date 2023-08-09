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
  BlobSidecarsRepository,
  BlobSidecarsArchiveRepository,
} from "../../../src/db/repositories/index.js";
import {createStubInstance} from "../types.js";

export class StubbedBeaconDb extends BeaconDb {
  db!: SinonStubbedInstance<LevelDbController>;

  block: SinonStubbedInstance<BlockRepository> & BlockRepository;
  blockArchive: SinonStubbedInstance<BlockArchiveRepository> & BlockArchiveRepository;

  blobSidecars: SinonStubbedInstance<BlobSidecarsRepository> & BlobSidecarsRepository;
  blobSidecarsArchive: SinonStubbedInstance<BlobSidecarsArchiveRepository> & BlobSidecarsArchiveRepository;

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
    super(config, {} as any);
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

    this.blobSidecars = createStubInstance(BlobSidecarsRepository);
    this.blobSidecarsArchive = createStubInstance(BlobSidecarsArchiveRepository);
  }
}
