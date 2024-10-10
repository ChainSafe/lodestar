import {vi, Mocked} from "vitest";
import {config as minimalConfig} from "@lodestar/config/default";
import {
  AttesterSlashingRepository,
  BlockArchiveRepository,
  BlockRepository,
  DepositEventRepository,
  DepositDataRootRepository,
  Eth1DataRepository,
  ProposerSlashingRepository,
  StateSnapshotArchiveRepository,
  StateDiffArchiveRepository,
  VoluntaryExitRepository,
  BLSToExecutionChangeRepository,
  BlobSidecarsRepository,
  BlobSidecarsArchiveRepository,
} from "../../src/db/repositories/index.js";
import {BeaconDb} from "../../src/db/index.js";

export type MockedBeaconDb = Mocked<BeaconDb> & {
  block: Mocked<BlockRepository>;
  blockArchive: Mocked<BlockArchiveRepository>;

  blobSidecars: Mocked<BlobSidecarsRepository>;
  blobSidecarsArchive: Mocked<BlobSidecarsArchiveRepository>;

  stateArchive: Mocked<StateSnapshotArchiveRepository>;

  voluntaryExit: Mocked<VoluntaryExitRepository>;
  blsToExecutionChange: Mocked<BLSToExecutionChangeRepository>;
  proposerSlashing: Mocked<ProposerSlashingRepository>;
  attesterSlashing: Mocked<AttesterSlashingRepository>;
  depositEvent: Mocked<DepositEventRepository>;

  depositDataRoot: Mocked<DepositDataRootRepository>;
  eth1Data: Mocked<Eth1DataRepository>;
};

vi.mock("../../src/db/repositories/index.js");

vi.mock("../../src/db/index.js", async (importActual) => {
  const mod = await importActual<typeof import("../../src/db/index.js")>();

  const mockedBeaconDb = vi.fn().mockImplementation(() => {
    return {
      block: vi.mocked(new BlockRepository({} as any, {} as any)),
      blockArchive: vi.mocked(new BlockArchiveRepository({} as any, {} as any)),
      stateSnapshotArchive: vi.mocked(new StateSnapshotArchiveRepository({} as any, {} as any)),
      stateDiffArchive: vi.mocked(new StateDiffArchiveRepository({} as any, {} as any)),

      voluntaryExit: vi.mocked(new VoluntaryExitRepository({} as any, {} as any)),
      blsToExecutionChange: vi.mocked(new BLSToExecutionChangeRepository({} as any, {} as any)),
      proposerSlashing: vi.mocked(new ProposerSlashingRepository({} as any, {} as any)),
      attesterSlashing: vi.mocked(new AttesterSlashingRepository({} as any, {} as any)),
      depositEvent: vi.mocked(new DepositEventRepository({} as any, {} as any)),

      depositDataRoot: vi.mocked(new DepositDataRootRepository({} as any, {} as any)),
      eth1Data: vi.mocked(new Eth1DataRepository({} as any, {} as any)),

      blobSidecars: vi.mocked(new BlobSidecarsRepository({} as any, {} as any)),
      blobSidecarsArchive: vi.mocked(new BlobSidecarsArchiveRepository({} as any, {} as any)),
    };
  });

  return {
    ...mod,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    BeaconDb: mockedBeaconDb,
  };
});

export function getMockedBeaconDb(): MockedBeaconDb {
  return new BeaconDb(minimalConfig, {} as any) as MockedBeaconDb;
}

vi.resetModules();
