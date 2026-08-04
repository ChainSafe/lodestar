import {Mocked, vi} from "vitest";
import {config as minimalConfig} from "@lodestar/config/default";
import type {IFlatFileStore} from "../../src/db/index.js";
import {BeaconDb} from "../../src/db/index.js";
import {
  AttesterSlashingRepository,
  BLSToExecutionChangeRepository,
  BlockArchiveRepository,
  BlockRepository,
  ProposerSlashingRepository,
  StateArchiveRepository,
  VoluntaryExitRepository,
} from "../../src/db/repositories/index.js";

export type MockedBeaconDb = Mocked<BeaconDb> & {
  block: Mocked<BlockRepository>;
  blockArchive: Mocked<BlockArchiveRepository>;

  stateArchive: Mocked<StateArchiveRepository>;

  voluntaryExit: Mocked<VoluntaryExitRepository>;
  blsToExecutionChange: Mocked<BLSToExecutionChangeRepository>;
  proposerSlashing: Mocked<ProposerSlashingRepository>;
  attesterSlashing: Mocked<AttesterSlashingRepository>;
};

vi.mock("../../src/db/repositories/index.js");

vi.mock("../../src/db/index.js", async (importActual) => {
  const mod = await importActual<typeof import("../../src/db/index.js")>();

  const mockedBeaconDb = vi.fn().mockImplementation(function MockedBeaconDb() {
    const flatFileStore: IFlatFileStore = {
      init: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      getBlobSidecars: vi.fn().mockResolvedValue(null),
      getBlobSidecarsBinary: vi.fn().mockResolvedValue(null),
      getBlobSidecarsBinaryBySlot: vi.fn().mockResolvedValue(null),
      putBlobSidecars: vi.fn().mockResolvedValue(undefined),
      putBlobSidecarsBinary: vi.fn().mockResolvedValue(undefined),
      getDataColumns: vi.fn().mockResolvedValue([]),
      getDataColumnsBinary: vi.fn().mockImplementation(async (_slot, _root, indices) => indices.map(() => undefined)),
      putDataColumnsBinary: vi.fn().mockResolvedValue(undefined),
      getDataColumnsBinaryBySlot: vi.fn().mockImplementation(async (_slot, indices) => indices.map(() => undefined)),
      deleteNonCanonical: vi.fn().mockResolvedValue(undefined),
      pruneBlobsBeforeSlot: vi.fn().mockResolvedValue(undefined),
      pruneColumnsBeforeSlot: vi.fn().mockResolvedValue(undefined),
    };

    return {
      block: vi.mocked(new BlockRepository({} as any, {} as any)),
      blockArchive: vi.mocked(new BlockArchiveRepository({} as any, {} as any)),
      stateArchive: vi.mocked(new StateArchiveRepository({} as any, {} as any)),

      voluntaryExit: vi.mocked(new VoluntaryExitRepository({} as any, {} as any)),
      blsToExecutionChange: vi.mocked(new BLSToExecutionChangeRepository({} as any, {} as any)),
      proposerSlashing: vi.mocked(new ProposerSlashingRepository({} as any, {} as any)),
      attesterSlashing: vi.mocked(new AttesterSlashingRepository({} as any, {} as any)),

      flatFileStore,
      initFlatFileStore: vi.fn().mockResolvedValue(undefined),
    };
  });

  return {
    ...mod,
    BeaconDb: mockedBeaconDb,
  };
});

export function getMockedBeaconDb(): MockedBeaconDb {
  return new BeaconDb(minimalConfig, {} as any) as MockedBeaconDb;
}

vi.resetModules();
