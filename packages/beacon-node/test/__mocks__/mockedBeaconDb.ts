import {vi, MockedObject} from "vitest";
import {LevelDbController} from "@lodestar/db";
import {config as minimalConfig} from "@lodestar/config/default";
import {BeaconDb} from "../../src/db/index.js";
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
} from "../../src/db/repositories/index.js";

vi.mock("@lodestar/db");
vi.mock("../../src/db/repositories/index.js");

export class MockedBeaconDb extends BeaconDb {
  db!: MockedObject<LevelDbController>;

  block: MockedObject<BlockRepository>;
  blockArchive: MockedObject<BlockArchiveRepository>;

  blobSidecars: MockedObject<BlobSidecarsRepository>;
  blobSidecarsArchive: MockedObject<BlobSidecarsArchiveRepository>;

  stateArchive: MockedObject<StateArchiveRepository>;

  voluntaryExit: MockedObject<VoluntaryExitRepository>;
  blsToExecutionChange: MockedObject<BLSToExecutionChangeRepository>;
  proposerSlashing: MockedObject<ProposerSlashingRepository>;
  attesterSlashing: MockedObject<AttesterSlashingRepository>;
  depositEvent: MockedObject<DepositEventRepository>;

  depositDataRoot: MockedObject<DepositDataRootRepository>;
  eth1Data: MockedObject<Eth1DataRepository>;

  constructor(config = minimalConfig) {
    // eslint-disable-next-line
    super(config, {} as any);
    this.block = vi.mocked(new BlockRepository());
    this.blockArchive = vi.mocked(new BlockArchiveRepository());
    this.stateArchive = vi.mocked(new StateArchiveRepository());

    this.voluntaryExit = vi.mocked(new VoluntaryExitRepository());
    this.blsToExecutionChange = vi.mocked(new BLSToExecutionChangeRepository());
    this.proposerSlashing = vi.mocked(new ProposerSlashingRepository());
    this.attesterSlashing = vi.mocked(new AttesterSlashingRepository());
    this.depositEvent = vi.mocked(new DepositEventRepository());

    this.depositDataRoot = vi.mocked(new DepositDataRootRepository());
    this.eth1Data = vi.mocked(new Eth1DataRepository());

    this.blobSidecars = vi.mocked(new BlobSidecarsRepository());
    this.blobSidecarsArchive = vi.mocked(new BlobSidecarsArchiveRepository());
  }
}

export function getMockedBeaconDb(): MockedBeaconDb {
  return new MockedBeaconDb();
}
