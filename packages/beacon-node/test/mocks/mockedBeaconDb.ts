import {Mocked, vi} from "vitest";
import {config as minimalConfig} from "@lodestar/config/default";
import type {Db} from "@lodestar/db";
import {testLogger} from "@lodestar/logger/test-utils";
import {BeaconDb, type IDataColumnStore} from "../../src/db/index.js";
import {
  AttesterSlashingRepository,
  BLSToExecutionChangeRepository,
  BlobSidecarsArchiveRepository,
  BlobSidecarsRepository,
  BlockArchiveRepository,
  BlockRepository,
  DataColumnSidecarArchiveRepository,
  DataColumnSidecarRepository,
  ExecutionPayloadEnvelopeArchiveRepository,
  ExecutionPayloadEnvelopeRepository,
  ProposerPreferencesRepository,
  ProposerSlashingRepository,
  StateArchiveRepository,
  VoluntaryExitRepository,
} from "../../src/db/repositories/index.js";

export type MockedBeaconDb = Mocked<BeaconDb> & {
  block: Mocked<BlockRepository>;
  blockArchive: Mocked<BlockArchiveRepository>;

  blobSidecars: Mocked<BlobSidecarsRepository>;
  blobSidecarsArchive: Mocked<BlobSidecarsArchiveRepository>;

  dataColumnSidecar: Mocked<DataColumnSidecarRepository>;
  dataColumnSidecarArchive: Mocked<DataColumnSidecarArchiveRepository>;

  executionPayloadEnvelope: Mocked<ExecutionPayloadEnvelopeRepository>;
  executionPayloadEnvelopeArchive: Mocked<ExecutionPayloadEnvelopeArchiveRepository>;

  stateArchive: Mocked<StateArchiveRepository>;

  voluntaryExit: Mocked<VoluntaryExitRepository>;
  blsToExecutionChange: Mocked<BLSToExecutionChangeRepository>;
  proposerSlashing: Mocked<ProposerSlashingRepository>;
  attesterSlashing: Mocked<AttesterSlashingRepository>;
  proposerPreferences: Mocked<ProposerPreferencesRepository>;
};

vi.mock("../../src/db/repositories/index.js");

vi.mock("../../src/db/index.js", async (importActual) => {
  const mod = await importActual<typeof import("../../src/db/index.js")>();

  const mockedBeaconDb = vi.fn().mockImplementation(function MockedBeaconDb() {
    const dataColumns: IDataColumnStore = {
      getAll: vi.fn().mockResolvedValue([]),
      getManyBinary: vi.fn().mockImplementation(async (_key, indices) => indices.map(() => undefined)),
      putManyBinary: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue(undefined),
      pruneBefore: vi.fn().mockResolvedValue([]),
    };

    return {
      block: vi.mocked(new BlockRepository({} as any, {} as any)),
      blockArchive: vi.mocked(new BlockArchiveRepository({} as any, {} as any)),
      blobSidecars: vi.mocked(new BlobSidecarsRepository({} as any, {} as any)),
      blobSidecarsArchive: vi.mocked(new BlobSidecarsArchiveRepository({} as any, {} as any)),
      dataColumnSidecar: vi.mocked(new DataColumnSidecarRepository({} as any, {} as any)),
      dataColumnSidecarArchive: vi.mocked(new DataColumnSidecarArchiveRepository({} as any, {} as any)),
      // Own method mocks per instance: the vitest automock shares base Repository methods
      // (get, getBinary, batchDelete, ...) across all repository classes, which would make
      // calls from different repositories indistinguishable in tests.
      executionPayloadEnvelope: Object.assign(vi.mocked(new ExecutionPayloadEnvelopeRepository({} as any, {} as any)), {
        get: vi.fn().mockResolvedValue(null),
        getBinary: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        batchDelete: vi.fn().mockResolvedValue(undefined),
        encodeKey: vi.fn(() => new Uint8Array(0)),
      }),
      executionPayloadEnvelopeArchive: Object.assign(
        vi.mocked(new ExecutionPayloadEnvelopeArchiveRepository({} as any, {} as any)),
        {getBinary: vi.fn().mockResolvedValue(null), batchArchiveAndDeleteHot: vi.fn().mockResolvedValue(undefined)}
      ),
      stateArchive: vi.mocked(new StateArchiveRepository({} as any, {} as any)),

      voluntaryExit: vi.mocked(new VoluntaryExitRepository({} as any, {} as any)),
      blsToExecutionChange: vi.mocked(new BLSToExecutionChangeRepository({} as any, {} as any)),
      proposerSlashing: vi.mocked(new ProposerSlashingRepository({} as any, {} as any)),
      attesterSlashing: vi.mocked(new AttesterSlashingRepository({} as any, {} as any)),
      proposerPreferences: vi.mocked(new ProposerPreferencesRepository({} as any, {} as any)),

      dataColumns,
      init: vi.fn().mockResolvedValue(undefined),
    };
  });

  return {
    ...mod,
    BeaconDb: mockedBeaconDb,
  };
});

const mockedDbLogger = testLogger();

export function getMockedBeaconDb(): MockedBeaconDb {
  return new BeaconDb(minimalConfig, {} as Db, {
    dataColumnDir: "data_columns",
    logger: mockedDbLogger,
  }) as MockedBeaconDb;
}

vi.resetModules();
