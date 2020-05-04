import {SinonSandbox, SinonStubbedInstance} from "sinon";

import {config as mainnetConfig} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {SignedBeaconBlock, BeaconState, BLSPubkey, ValidatorIndex} from "@chainsafe/lodestar-types";

import {BeaconDb, LevelDbController} from "../../../src/db";
import {
  AttesterSlashingRepository,
  AggregateAndProofRepository,
  AttestationRepository,
  BadBlockRepository,
  BlockRepository,
  BlockArchiveRepository,
  ChainRepository,
  DepositDataRepository,
  DepositDataRootListRepository,
  ProposerSlashingRepository,
  StateRepository,
  VoluntaryExitRepository,
} from "../../../src/db/api/beacon/repositories";

export class StubbedBeaconDb extends BeaconDb {
  public db: SinonStubbedInstance<LevelDbController>;

  public chain: SinonStubbedInstance<ChainRepository> & ChainRepository;
  public state: SinonStubbedInstance<StateRepository> & StateRepository;
  public badBlock: SinonStubbedInstance<BadBlockRepository> & BadBlockRepository;
  public block: SinonStubbedInstance<BlockRepository> & BlockRepository;
  public blockArchive: SinonStubbedInstance<BlockArchiveRepository> & BlockArchiveRepository;

  public attestation: SinonStubbedInstance<AttestationRepository> & AttestationRepository;
  public aggregateAndProof: SinonStubbedInstance<AggregateAndProofRepository> & AggregateAndProofRepository;
  public voluntaryExit: SinonStubbedInstance<VoluntaryExitRepository> & VoluntaryExitRepository;
  public proposerSlashing: SinonStubbedInstance<ProposerSlashingRepository> & ProposerSlashingRepository;
  public attesterSlashing: SinonStubbedInstance<AttesterSlashingRepository> & AttesterSlashingRepository;
  public depositData: SinonStubbedInstance<DepositDataRepository> & DepositDataRepository;

  public depositDataRootList: SinonStubbedInstance<DepositDataRootListRepository> & DepositDataRootListRepository;

  public storeChainHead:
  SinonStubbedInstance<(block: SignedBeaconBlock, state: BeaconState) => Promise<void>>
  &
  ((block: SignedBeaconBlock, state: BeaconState) => Promise<void>);

  public updateChainHead:
  SinonStubbedInstance<(blockRoot: Uint8Array, stateRoot: Uint8Array) => Promise<void>>
  &
  ((blockRoot: Uint8Array, stateRoot: Uint8Array) => Promise<void>);

  public getValidatorIndex:
  SinonStubbedInstance<(publicKey: BLSPubkey) => Promise<ValidatorIndex>>
  &
  ((publicKey: BLSPubkey) => Promise<ValidatorIndex>);

  public processBlockOperations:
  SinonStubbedInstance<(signedBlock: SignedBeaconBlock) => Promise<void>>
  &
  ((signedBlock: SignedBeaconBlock) => Promise<void>);

  constructor(sinon: SinonSandbox, config = mainnetConfig) {
    super({
      config,
      controller: sinon.createStubInstance(LevelDbController),
    });
    this.chain = sinon.createStubInstance(ChainRepository) as any;
    this.state = sinon.createStubInstance(StateRepository) as any;
    this.badBlock = sinon.createStubInstance(BadBlockRepository) as any;
    this.block = sinon.createStubInstance(BlockRepository) as any;
    this.blockArchive = sinon.createStubInstance(BlockArchiveRepository) as any;
    this.depositDataRootList = sinon.createStubInstance(DepositDataRootListRepository) as any;

    this.attestation = sinon.createStubInstance(AttestationRepository) as any;
    this.aggregateAndProof = sinon.createStubInstance(AggregateAndProofRepository) as any;
    this.voluntaryExit = sinon.createStubInstance(VoluntaryExitRepository) as any;
    this.proposerSlashing = sinon.createStubInstance(ProposerSlashingRepository) as any;
    this.attesterSlashing = sinon.createStubInstance(AttesterSlashingRepository) as any;
    this.depositData = sinon.createStubInstance(DepositDataRepository) as any;

    this.storeChainHead = sinon.stub(this, "storeChainHead") as any;
    this.updateChainHead = sinon.stub(this, "updateChainHead") as any;
    this.getValidatorIndex = sinon.stub(this, "getValidatorIndex") as any;
    this.processBlockOperations = sinon.stub(this, "processBlockOperations") as any;
  }
}
