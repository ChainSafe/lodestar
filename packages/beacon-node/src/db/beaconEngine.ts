import {ChainForkConfig} from "@lodestar/config";
import {Db} from "@lodestar/db";
import {IBeaconEngineDb} from "./interface.js";
import {CheckpointStateRepository} from "./repositories/checkpointState.js";
import {EarliestAvailableSlotRepository} from "./repositories/earliestAvailableSlot.js";
import {
  AttesterSlashingRepository,
  BLSToExecutionChangeRepository,
  BestLightClientUpdateRepository,
  BlockArchiveRepository,
  BlockRepository,
  CheckpointHeaderRepository,
  ExecutionPayloadEnvelopeArchiveRepository,
  ExecutionPayloadEnvelopeRepository,
  ProposerPreferencesRepository,
  ProposerSlashingRepository,
  StateArchiveRepository,
  SyncCommitteeRepository,
  SyncCommitteeWitnessRepository,
  VoluntaryExitRepository,
} from "./repositories/index.js";

export class BeaconEngineDb implements IBeaconEngineDb {
  block: BlockRepository;
  blockArchive: BlockArchiveRepository;
  executionPayloadEnvelope: ExecutionPayloadEnvelopeRepository;
  executionPayloadEnvelopeArchive: ExecutionPayloadEnvelopeArchiveRepository;
  stateArchive: StateArchiveRepository;
  checkpointState: CheckpointStateRepository;
  earliestAvailableSlot: EarliestAvailableSlotRepository;
  voluntaryExit: VoluntaryExitRepository;
  proposerSlashing: ProposerSlashingRepository;
  proposerPreferences: ProposerPreferencesRepository;
  attesterSlashing: AttesterSlashingRepository;
  blsToExecutionChange: BLSToExecutionChangeRepository;
  bestLightClientUpdate: BestLightClientUpdateRepository;
  checkpointHeader: CheckpointHeaderRepository;
  syncCommittee: SyncCommitteeRepository;
  syncCommitteeWitness: SyncCommitteeWitnessRepository;

  constructor(
    config: ChainForkConfig,
    protected readonly db: Db
  ) {
    this.block = new BlockRepository(config, db);
    this.blockArchive = new BlockArchiveRepository(config, db);
    this.executionPayloadEnvelope = new ExecutionPayloadEnvelopeRepository(config, db);
    this.executionPayloadEnvelopeArchive = new ExecutionPayloadEnvelopeArchiveRepository(config, db);
    this.stateArchive = new StateArchiveRepository(config, db);
    this.checkpointState = new CheckpointStateRepository(config, db);
    this.earliestAvailableSlot = new EarliestAvailableSlotRepository(db);
    this.voluntaryExit = new VoluntaryExitRepository(config, db);
    this.blsToExecutionChange = new BLSToExecutionChangeRepository(config, db);
    this.proposerSlashing = new ProposerSlashingRepository(config, db);
    this.proposerPreferences = new ProposerPreferencesRepository(config, db);
    this.attesterSlashing = new AttesterSlashingRepository(config, db);
    this.bestLightClientUpdate = new BestLightClientUpdateRepository(config, db);
    this.checkpointHeader = new CheckpointHeaderRepository(config, db);
    this.syncCommittee = new SyncCommitteeRepository(config, db);
    this.syncCommitteeWitness = new SyncCommitteeWitnessRepository(config, db);
  }
}
