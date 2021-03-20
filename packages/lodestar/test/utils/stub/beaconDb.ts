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
    this.badBlock = sinon.createStubInstance(BadBlockRepository) as SinonStubbedInstance<BadBlockRepository> &
      BadBlockRepository;
    this.block = sinon.createStubInstance(BlockRepository) as SinonStubbedInstance<BlockRepository> & BlockRepository;
    this.pendingBlock = sinon.createStubInstance(PendingBlockRepository) as SinonStubbedInstance<
      PendingBlockRepository
    > &
      PendingBlockRepository;
    this.blockArchive = sinon.createStubInstance(BlockArchiveRepository) as SinonStubbedInstance<
      BlockArchiveRepository
    > &
      BlockArchiveRepository;
    this.stateArchive = sinon.createStubInstance(StateArchiveRepository) as SinonStubbedInstance<
      StateArchiveRepository
    > &
      StateArchiveRepository;

    this.attestation = sinon.createStubInstance(AttestationRepository) as SinonStubbedInstance<AttestationRepository> &
      AttestationRepository;
    this.aggregateAndProof = sinon.createStubInstance(AggregateAndProofRepository) as SinonStubbedInstance<
      AggregateAndProofRepository
    > &
      AggregateAndProofRepository;
    this.voluntaryExit = sinon.createStubInstance(VoluntaryExitRepository) as SinonStubbedInstance<
      VoluntaryExitRepository
    > &
      VoluntaryExitRepository;
    this.proposerSlashing = sinon.createStubInstance(ProposerSlashingRepository) as SinonStubbedInstance<
      ProposerSlashingRepository
    > &
      ProposerSlashingRepository;
    this.attesterSlashing = sinon.createStubInstance(AttesterSlashingRepository) as SinonStubbedInstance<
      AttesterSlashingRepository
    > &
      AttesterSlashingRepository;
    this.depositEvent = sinon.createStubInstance(DepositEventRepository) as SinonStubbedInstance<
      DepositEventRepository
    > &
      DepositEventRepository;

    this.depositDataRoot = sinon.createStubInstance(DepositDataRootRepository) as SinonStubbedInstance<
      DepositDataRootRepository
    > &
      DepositDataRootRepository;
    this.eth1Data = sinon.createStubInstance(Eth1DataRepository) as SinonStubbedInstance<Eth1DataRepository> &
      Eth1DataRepository;
    this.seenAttestationCache = sinon.createStubInstance(SeenAttestationCache) as SinonStubbedInstance<
      SeenAttestationCache
    > &
      SeenAttestationCache;
    this.processBlockOperations = sinon.stub(this, "processBlockOperations") as (
      signedBlock: SignedBeaconBlock
    ) => Promise<void>;
  }
}
