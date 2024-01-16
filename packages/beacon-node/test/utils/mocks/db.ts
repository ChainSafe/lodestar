import {vi} from "vitest";
import {IBeaconDb} from "../../../src/db/index.js";
import {CheckpointStateRepository} from "../../../src/db/repositories/checkpointState.js";
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
  BestLightClientUpdateRepository,
  CheckpointHeaderRepository,
  SyncCommitteeRepository,
  SyncCommitteeWitnessRepository,
  BackfilledRanges,
  BlobSidecarsRepository,
  BlobSidecarsArchiveRepository,
  BLSToExecutionChangeRepository,
} from "../../../src/db/repositories/index.js";
import {PreGenesisState, PreGenesisStateLastProcessedBlock} from "../../../src/db/single/index.js";

vi.mock("../../../src/db/repositories/index.js");

/* eslint-disable @typescript-eslint/no-empty-function */

/**
 * Stubbed BeaconDb that ignores all DELETE and PUT actions, and returns void on all GET actions
 */
export function getStubbedBeaconDb(): IBeaconDb {
  return {
    // unfinalized blocks
    // @ts-expect-error - Mocked constructor does not need arguments
    block: vi.mocked(new BlockRepository()),
    // finalized blocks
    // @ts-expect-error - Mocked constructor does not need arguments
    blockArchive: vi.mocked(new BlockArchiveRepository()),

    // @ts-expect-error - Mocked constructor does not need arguments
    blobSidecars: vi.mocked(new BlobSidecarsRepository()),
    // @ts-expect-error - Mocked constructor does not need arguments
    blobSidecarsArchive: vi.mocked(new BlobSidecarsArchiveRepository()),

    // finalized states
    // @ts-expect-error - Mocked constructor does not need arguments
    stateArchive: vi.mocked(new StateArchiveRepository()),
    // @ts-expect-error - Mocked constructor does not need arguments
    checkpointState: vi.mocked(new CheckpointStateRepository()),

    // op pool
    // @ts-expect-error - Mocked constructor does not need arguments
    voluntaryExit: vi.mocked(new VoluntaryExitRepository()),
    // @ts-expect-error - Mocked constructor does not need arguments
    proposerSlashing: vi.mocked(new ProposerSlashingRepository()),
    // @ts-expect-error - Mocked constructor does not need arguments
    attesterSlashing: vi.mocked(new AttesterSlashingRepository()),
    // @ts-expect-error - Mocked constructor does not need arguments
    depositEvent: vi.mocked(new DepositEventRepository()),
    // @ts-expect-error - Mocked constructor does not need arguments
    blsToExecutionChange: vi.mocked(new BLSToExecutionChangeRepository()),

    // eth1 processing
    // @ts-expect-error - Mocked constructor does not need arguments
    preGenesisState: vi.mocked(new PreGenesisState()),
    // @ts-expect-error - Mocked constructor does not need arguments
    preGenesisStateLastProcessedBlock: vi.mocked(new PreGenesisStateLastProcessedBlock()),

    // all deposit data roots and merkle tree
    // @ts-expect-error - Mocked constructor does not need arguments
    depositDataRoot: vi.mocked(new DepositDataRootRepository()),
    // @ts-expect-error - Mocked constructor does not need arguments
    eth1Data: vi.mocked(new Eth1DataRepository()),

    // lightclient
    // @ts-expect-error - Mocked constructor does not need arguments
    bestLightClientUpdate: vi.mocked(new BestLightClientUpdateRepository()),
    // @ts-expect-error - Mocked constructor does not need arguments
    checkpointHeader: vi.mocked(new CheckpointHeaderRepository()),
    // @ts-expect-error - Mocked constructor does not need arguments
    syncCommittee: vi.mocked(new SyncCommitteeRepository()),
    // @ts-expect-error - Mocked constructor does not need arguments
    syncCommitteeWitness: vi.mocked(new SyncCommitteeWitnessRepository()),

    // @ts-expect-error - Mocked constructor does not need arguments
    backfilledRanges: vi.mocked(new BackfilledRanges()),

    async close(): Promise<void> {},
    /** To inject metrics after CLI initialization */
    setMetrics(): void {},
    async pruneHotDb(): Promise<void> {},
  };
}
