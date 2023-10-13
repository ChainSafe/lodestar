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
    this.block = vi.mocked(new BlockRepository({} as any, {} as any));
    this.blockArchive = vi.mocked(new BlockArchiveRepository({} as any, {} as any));
    this.stateArchive = vi.mocked(new StateArchiveRepository({} as any, {} as any));

    this.voluntaryExit = vi.mocked(new VoluntaryExitRepository({} as any, {} as any));
    this.blsToExecutionChange = vi.mocked(new BLSToExecutionChangeRepository({} as any, {} as any));
    this.proposerSlashing = vi.mocked(new ProposerSlashingRepository({} as any, {} as any));
    this.attesterSlashing = vi.mocked(new AttesterSlashingRepository({} as any, {} as any));
    this.depositEvent = vi.mocked(new DepositEventRepository({} as any, {} as any));

    this.depositDataRoot = vi.mocked(new DepositDataRootRepository({} as any, {} as any));
    this.eth1Data = vi.mocked(new Eth1DataRepository({} as any, {} as any));

    this.blobSidecars = vi.mocked(new BlobSidecarsRepository({} as any, {} as any));
    this.blobSidecarsArchive = vi.mocked(new BlobSidecarsArchiveRepository({} as any, {} as any));
  }
}

export function getMockedBeaconDb(): MockedBeaconDb {
  return new MockedBeaconDb();
}
