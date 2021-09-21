import {SinonSandbox, SinonStubbedInstance} from "sinon";
import {phase0} from "@chainsafe/lodestar-types";
import {LevelDbController} from "@chainsafe/lodestar-db";

import {BeaconDb} from "../../../src/db";
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
} from "../../../src/db/repositories";
import {config as minimalConfig} from "@chainsafe/lodestar-config/default";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types/phase0";
import {createStubInstance} from "../types";

export class StubbedBeaconDb extends BeaconDb {
  db!: SinonStubbedInstance<LevelDbController>;

  block: SinonStubbedInstance<BlockRepository> & BlockRepository;
  blockArchive: SinonStubbedInstance<BlockArchiveRepository> & BlockArchiveRepository;
  stateArchive: SinonStubbedInstance<StateArchiveRepository> & StateArchiveRepository;

  voluntaryExit: SinonStubbedInstance<VoluntaryExitRepository> & VoluntaryExitRepository;
  proposerSlashing: SinonStubbedInstance<ProposerSlashingRepository> & ProposerSlashingRepository;
  attesterSlashing: SinonStubbedInstance<AttesterSlashingRepository> & AttesterSlashingRepository;
  depositEvent: SinonStubbedInstance<DepositEventRepository> & DepositEventRepository;

  depositDataRoot: SinonStubbedInstance<DepositDataRootRepository> & DepositDataRootRepository;
  eth1Data: SinonStubbedInstance<Eth1DataRepository> & Eth1DataRepository;

  processBlockOperations: SinonStubbedInstance<(signedBlock: phase0.SignedBeaconBlock) => Promise<void>> &
    ((signedBlock: phase0.SignedBeaconBlock) => Promise<void>);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(sinon: SinonSandbox, config = minimalConfig) {
    // eslint-disable-next-line
    super({config, controller: {} as any});
    this.block = createStubInstance(BlockRepository);
    this.blockArchive = createStubInstance(BlockArchiveRepository);
    this.stateArchive = createStubInstance(StateArchiveRepository);

    this.voluntaryExit = createStubInstance(VoluntaryExitRepository);
    this.proposerSlashing = createStubInstance(ProposerSlashingRepository);
    this.attesterSlashing = createStubInstance(AttesterSlashingRepository);
    this.depositEvent = createStubInstance(DepositEventRepository);

    this.depositDataRoot = createStubInstance(DepositDataRootRepository);
    this.eth1Data = createStubInstance(Eth1DataRepository);
    this.processBlockOperations = sinon.stub(this, "processBlockOperations") as (
      signedBlock: SignedBeaconBlock
    ) => Promise<void>;
  }
}
