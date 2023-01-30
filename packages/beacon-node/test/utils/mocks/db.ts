import {IBeaconDb} from "../../../src/db/index.js";
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
  BlobsSidecarRepository,
  BlobsSidecarArchiveRepository,
  BLSToExecutionChangeRepository,
} from "../../../src/db/repositories/index.js";
import {PreGenesisState, PreGenesisStateLastProcessedBlock} from "../../../src/db/single/index.js";
import {createStubInstance} from "../types.js";

/* eslint-disable @typescript-eslint/no-empty-function */

/**
 * Stubbed BeaconDb that ignores all DELETE and PUT actions, and returns void on all GET actions
 */
export function getStubbedBeaconDb(): IBeaconDb {
  return {
    // unfinalized blocks
    block: createStubInstance(BlockRepository),
    blobsSidecar: createStubInstance(BlobsSidecarRepository),

    // finalized blocks
    blockArchive: createStubInstance(BlockArchiveRepository),
    blobsSidecarArchive: createStubInstance(BlobsSidecarArchiveRepository),

    // finalized states
    stateArchive: createStubInstance(StateArchiveRepository),

    // op pool
    voluntaryExit: createStubInstance(VoluntaryExitRepository),
    proposerSlashing: createStubInstance(ProposerSlashingRepository),
    attesterSlashing: createStubInstance(AttesterSlashingRepository),
    depositEvent: createStubInstance(DepositEventRepository),
    blsToExecutionChange: createStubInstance(BLSToExecutionChangeRepository),

    // eth1 processing
    preGenesisState: createStubInstance(PreGenesisState),
    preGenesisStateLastProcessedBlock: createStubInstance(PreGenesisStateLastProcessedBlock),

    // all deposit data roots and merkle tree
    depositDataRoot: createStubInstance(DepositDataRootRepository),
    eth1Data: createStubInstance(Eth1DataRepository),

    // lightclient
    bestLightClientUpdate: createStubInstance(BestLightClientUpdateRepository),
    checkpointHeader: createStubInstance(CheckpointHeaderRepository),
    syncCommittee: createStubInstance(SyncCommitteeRepository),
    syncCommitteeWitness: createStubInstance(SyncCommitteeWitnessRepository),

    backfilledRanges: createStubInstance(BackfilledRanges),

    /** Start the connection to the db instance and open the db store. */
    async start(): Promise<void> {},
    /**  Stop the connection to the db instance and close the db store. */
    async stop(): Promise<void> {},
    /** To inject metrics after CLI initialization */
    setMetrics(): void {},
    async pruneHotDb(): Promise<void> {},
  };
}
