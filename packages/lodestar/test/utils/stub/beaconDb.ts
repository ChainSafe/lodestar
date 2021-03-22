import {SinonSandbox, SinonStubbedInstance} from "sinon";
import {phase0} from "@chainsafe/lodestar-types";
import {LevelDbController} from "@chainsafe/lodestar-db";

import {BeaconDb} from "../../../src/db";
import {
  AggregateAndProofRepository,
  AttestationRepository,
  AttesterSlashingRepository,
  BadBlockRepository,
  BlockArchiveRepository,
  BlockRepository,
  DepositEventRepository,
  DepositDataRootRepository,
  Eth1DataRepository,
  ProposerSlashingRepository,
  StateArchiveRepository,
  VoluntaryExitRepository,
} from "../../../src/db/api/beacon/repositories";
import {SeenAttestationCache} from "../../../src/db/api/beacon/seenAttestationCache";
import {minimalConfig} from "@chainsafe/lodestar-config/minimal";
import {PendingBlockRepository} from "../../../src/db/api/beacon/repositories/pendingBlock";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types/phase0";
import {createStubInstance} from "../types";

export class StubbedBeaconDb extends BeaconDb {
  db!: SinonStubbedInstance<LevelDbController>;

  badBlock: SinonStubbedInstance<BadBlockRepository> & BadBlockRepository;
  block: SinonStubbedInstance<BlockRepository> & BlockRepository;
  pendingBlock: SinonStubbedInstance<PendingBlockRepository> & PendingBlockRepository;
  blockArchive: SinonStubbedInstance<BlockArchiveRepository> & BlockArchiveRepository;
  stateArchive: SinonStubbedInstance<StateArchiveRepository> & StateArchiveRepository;

  attestation: SinonStubbedInstance<AttestationRepository> & AttestationRepository;
  aggregateAndProof: SinonStubbedInstance<AggregateAndProofRepository> & AggregateAndProofRepository;
  voluntaryExit: SinonStubbedInstance<VoluntaryExitRepository> & VoluntaryExitRepository;
  proposerSlashing: SinonStubbedInstance<ProposerSlashingRepository> & ProposerSlashingRepository;
  attesterSlashing: SinonStubbedInstance<AttesterSlashingRepository> & AttesterSlashingRepository;
  depositEvent: SinonStubbedInstance<DepositEventRepository> & DepositEventRepository;

  depositDataRoot: SinonStubbedInstance<DepositDataRootRepository> & DepositDataRootRepository;
  eth1Data: SinonStubbedInstance<Eth1DataRepository> & Eth1DataRepository;

  seenAttestationCache: SinonStubbedInstance<SeenAttestationCache> & SeenAttestationCache;

  processBlockOperations: SinonStubbedInstance<(signedBlock: phase0.SignedBeaconBlock) => Promise<void>> &
    ((signedBlock: phase0.SignedBeaconBlock) => Promise<void>);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(sinon: SinonSandbox, config = minimalConfig) {
    super({config, controller: null!});
    this.badBlock = createStubInstance(BadBlockRepository);
    this.block = createStubInstance(BlockRepository);
    this.pendingBlock = createStubInstance(PendingBlockRepository);
    this.blockArchive = createStubInstance(BlockArchiveRepository);
    this.stateArchive = createStubInstance(StateArchiveRepository);

    this.attestation = createStubInstance(AttestationRepository);
    this.aggregateAndProof = createStubInstance(AggregateAndProofRepository);
    this.voluntaryExit = createStubInstance(VoluntaryExitRepository);
    this.proposerSlashing = createStubInstance(ProposerSlashingRepository);
    this.attesterSlashing = createStubInstance(AttesterSlashingRepository);
    this.depositEvent = createStubInstance(DepositEventRepository);

    this.depositDataRoot = createStubInstance(DepositDataRootRepository);
    this.eth1Data = createStubInstance(Eth1DataRepository);
    this.seenAttestationCache = createStubInstance(SeenAttestationCache);
    this.processBlockOperations = sinon.stub(this, "processBlockOperations") as (
      signedBlock: SignedBeaconBlock
    ) => Promise<void>;
  }
}
