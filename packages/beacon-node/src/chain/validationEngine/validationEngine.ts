import {BitArray} from "@chainsafe/ssz";
import {ForkName, ForkPostElectra, isForkPostElectra} from "@lodestar/params";
import {
  IBeaconStateView,
  VoluntaryExitValidity,
  computeEpochAtSlot,
  getBeaconCommittees,
  signedBlockToSignedHeader,
} from "@lodestar/state-transition";
import {
  Attestation,
  AttesterSlashing,
  BeaconBlock,
  CommitteeIndex,
  Domain,
  Epoch,
  IndexedAttestation,
  Root,
  RootHex,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  Slot,
  SubcommitteeIndex,
  SubnetID,
  ValidatorIndex,
  altair,
  bellatrix,
  capella,
  deneb,
  fulu,
  gloas,
  heze,
  phase0,
} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockType, IBeaconChain} from "../interface.js";
import {PooledExecutionPayloadBid} from "../opPools/executionPayloadBidPool.js";
import {InclusionListInsertOutcome} from "../opPools/inclusionListStore.js";
import {InsertOutcome} from "../opPools/types.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {
  AggregateAndProofValidationResult,
  validateApiAggregateAndProof,
  validateGossipAggregateAndProof,
} from "../validation/aggregateAndProof.js";
import {
  ApiAttestation,
  AttestationValidationResult,
  BatchResult,
  GossipAttestation,
  validateApiAttestation,
  validateGossipAttestationsSameAttData,
} from "../validation/attestation.js";
import {validateApiAttesterSlashing, validateGossipAttesterSlashing} from "../validation/attesterSlashing.js";
import {validateGossipBlobSidecar} from "../validation/blobSidecar.js";
import {
  GossipBlockValidationResult,
  validateGossipBlock,
  validateGossipBlockWithUnknownParent,
  verifyBlockProposerSignature,
} from "../validation/block.js";
import {
  validateApiBlsToExecutionChange,
  validateGossipBlsToExecutionChange,
} from "../validation/blsToExecutionChange.js";
import {
  validateGossipFuluDataColumnSidecar,
  validateGossipGloasDataColumnSidecar,
} from "../validation/dataColumnSidecar.js";
import {
  ExecutionPayloadBidValidationResult,
  validateGossipExecutionPayloadBid,
} from "../validation/executionPayloadBid.js";
import {
  validateApiExecutionPayloadEnvelope,
  validateGossipExecutionPayloadEnvelope,
} from "../validation/executionPayloadEnvelope.js";
import {InclusionListValidationResult, validateGossipInclusionList} from "../validation/inclusionList.js";
import {
  PayloadAttestationValidationResult,
  validateApiPayloadAttestationMessage,
  validateGossipPayloadAttestationMessage,
} from "../validation/payloadAttestationMessage.js";
import {validateGossipProposerPreferences} from "../validation/proposerPreferences.js";
import {validateApiProposerSlashing, validateGossipProposerSlashing} from "../validation/proposerSlashing.js";
import {
  SyncCommitteeMessageValidationResult,
  validateApiSyncCommittee,
  validateGossipSyncCommittee,
} from "../validation/syncCommittee.js";
import {
  ContributionAndProofValidationResult,
  validateApiContributionAndProof,
  validateSyncCommitteeGossipContributionAndProof,
} from "../validation/syncCommitteeContributionAndProof.js";
import {
  ApiVoluntaryExitResult,
  validateApiVoluntaryExit,
  validateGossipVoluntaryExit,
} from "../validation/voluntaryExit.js";
import {IValidationEngine, ImportAttestationOpts, ValidationTopic} from "./interface.js";

export class ValidationEngine implements IValidationEngine {
  constructor(private readonly chain: IBeaconChain) {}

  onSlot(slot: Slot): void {
    this.chain.seenAttestationDatas.onSlot(slot);
    this.chain.seenSyncCommitteeMessages.prune(slot);
    this.chain.seenExecutionPayloadBids.prune(slot);
  }

  onEpoch(epoch: Epoch): void {
    this.chain.seenAttesters.prune(epoch);
    this.chain.seenAggregators.prune(epoch);
    this.chain.seenAggregatedAttestations.prune(epoch);
    this.chain.seenPayloadAttesters.prune(epoch);
    this.chain.seenBlockAttesters.prune(epoch);
  }

  onNewHead(headSlot: Slot): void {
    this.chain.seenContributionAndProof.prune(headSlot);
  }

  onFinalized(finalizedSlot: Slot): void {
    this.chain.seenBlockProposers.prune(finalizedSlot);
  }

  close(): void {}

  onBlockVerified(signedBlock: SignedBeaconBlock, blockRootHex: RootHex): void {
    const {slot, proposerIndex} = signedBlock.message;
    this.chain.seenBlockProposers.observeBlockRoot(
      slot,
      proposerIndex,
      blockRootHex,
      signedBlockToSignedHeader(this.chain.config, signedBlock)
    );
  }

  onBlockImported(block: BeaconBlock, blockRootHex: RootHex): void {
    this.chain.seenBlockProposers.add(block.slot, block.proposerIndex, blockRootHex);
  }

  onBlockAttestationImported(
    fork: ForkName,
    state: IBeaconStateView,
    blockEpoch: Epoch,
    target: phase0.Checkpoint,
    attDataRootHex: RootHex,
    attestation: Attestation,
    indexedAttestation: IndexedAttestation
  ): void {
    this.chain.seenBlockAttesters.addIndices(blockEpoch, indexedAttestation.attestingIndices);

    const trueBitCount = indexedAttestation.attestingIndices.length;
    if (!isForkPostElectra(fork)) {
      this.chain.seenAggregatedAttestations.add(
        target.epoch,
        attestation.data.index,
        attDataRootHex,
        {aggregationBits: attestation.aggregationBits, trueBitCount},
        true
      );
      return;
    }

    const committeeIndices = (attestation as Attestation<ForkPostElectra>).committeeBits.getTrueBitIndexes();
    if (committeeIndices.length === 1) {
      this.chain.seenAggregatedAttestations.add(
        target.epoch,
        committeeIndices[0],
        attDataRootHex,
        {aggregationBits: attestation.aggregationBits, trueBitCount},
        true
      );
      return;
    }

    // An aggregate over several committees is split back into one seen entry per committee
    const attSlot = attestation.data.slot;
    const attEpoch = computeEpochAtSlot(attSlot);
    const shuffling =
      this.chain.stateEngine.getShufflingSync(attEpoch, state.getShufflingDecisionRoot(attEpoch)) ??
      state.getShufflingAtEpoch(attEpoch);
    const committees = getBeaconCommittees(shuffling, attSlot, committeeIndices);
    const aggregationBools = attestation.aggregationBits.toBoolArray();
    let offset = 0;
    for (let i = 0; i < committees.length; i++) {
      const committee = committees[i];
      const aggregationBits = BitArray.fromBoolArray(aggregationBools.slice(offset, offset + committee.length));
      offset += committee.length;
      this.chain.seenAggregatedAttestations.add(
        target.epoch,
        committeeIndices[i],
        attDataRootHex,
        {aggregationBits, trueBitCount: aggregationBits.getTrueBitIndexes().length},
        true
      );
    }
  }

  validateGossipAttestationsSameAttData(fork: ForkName, attestations: GossipAttestation[]): Promise<BatchResult> {
    return validateGossipAttestationsSameAttData(fork, this.chain, attestations);
  }

  validateApiAttestation(fork: ForkName, attestation: ApiAttestation): Promise<AttestationValidationResult> {
    return validateApiAttestation(fork, this.chain, attestation);
  }

  importAttestation(result: AttestationValidationResult, opts: ImportAttestationOpts): InsertOutcome | null {
    const {attestation, indexedAttestation, attDataRootHex, committeeIndex, validatorCommitteeIndex, committeeSize} =
      result;
    let insertOutcome: InsertOutcome | null = null;
    if (opts.addToPool) {
      try {
        insertOutcome = this.chain.attestationPool.add(
          committeeIndex,
          attestation,
          attDataRootHex,
          validatorCommitteeIndex,
          committeeSize,
          opts.priority
        );
      } catch (e) {
        this.chain.logger.debug("Error adding unaggregated attestation to pool", {subnet: result.subnet}, e as Error);
      }
    }

    if (opts.addToForkChoice) {
      try {
        this.chain.forkChoice.onAttestation(indexedAttestation, attDataRootHex);
      } catch (e) {
        this.chain.logger.debug(
          "Error adding unaggregated attestation to forkchoice",
          {subnet: result.subnet},
          e as Error
        );
      }
    }

    return insertOutcome;
  }

  validateGossipAggregateAndProof(
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof,
    serializedData: Uint8Array
  ): Promise<AggregateAndProofValidationResult> {
    return validateGossipAggregateAndProof(fork, this.chain, signedAggregateAndProof, serializedData);
  }

  validateApiAggregateAndProof(
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<AggregateAndProofValidationResult> {
    return validateApiAggregateAndProof(fork, this.chain, signedAggregateAndProof);
  }

  importAggregateAndProof(
    signedAggregateAndProof: SignedAggregateAndProof,
    result: AggregateAndProofValidationResult,
    opts: {addToForkChoice: boolean}
  ): InsertOutcome {
    const {indexedAttestation, committeeValidatorIndices, attDataRootHex} = result;
    const insertOutcome = this.chain.aggregatedAttestationPool.add(
      signedAggregateAndProof.message.aggregate,
      attDataRootHex,
      indexedAttestation.attestingIndices.length,
      committeeValidatorIndices
    );
    if (opts.addToForkChoice) {
      this.chain.forkChoice.onAttestation(indexedAttestation, attDataRootHex);
    }
    return insertOutcome;
  }

  validateGossipSyncCommitteeMessage(
    message: altair.SyncCommitteeMessage,
    subnet: SubnetID
  ): Promise<SyncCommitteeMessageValidationResult> {
    return validateGossipSyncCommittee(this.chain, message, subnet);
  }

  validateApiSyncCommitteeMessage(message: altair.SyncCommitteeMessage): Promise<SyncCommitteeMessageValidationResult> {
    return validateApiSyncCommittee(this.chain, message);
  }

  importSyncCommitteeMessage(
    message: altair.SyncCommitteeMessage,
    result: SyncCommitteeMessageValidationResult,
    opts: {priority?: boolean}
  ): InsertOutcome[] {
    return result.positions.map(({subnet, indexInSubcommittee}) =>
      this.chain.syncCommitteeMessagePool.add(subnet, message, indexInSubcommittee, opts.priority)
    );
  }

  validateGossipContributionAndProof(
    signedContributionAndProof: altair.SignedContributionAndProof
  ): Promise<ContributionAndProofValidationResult> {
    return validateSyncCommitteeGossipContributionAndProof(this.chain, signedContributionAndProof);
  }

  validateApiContributionAndProof(
    signedContributionAndProof: altair.SignedContributionAndProof
  ): Promise<ContributionAndProofValidationResult> {
    return validateApiContributionAndProof(this.chain, signedContributionAndProof);
  }

  importContributionAndProof(
    signedContributionAndProof: altair.SignedContributionAndProof,
    result: ContributionAndProofValidationResult,
    opts: {priority?: boolean}
  ): InsertOutcome {
    return this.chain.syncContributionAndProofPool.add(
      signedContributionAndProof.message,
      result.syncCommitteeParticipantIndices.length,
      opts.priority
    );
  }

  validateGossipAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<[Domain, Domain]> {
    return validateGossipAttesterSlashing(this.chain, attesterSlashing);
  }

  validateApiAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<[Domain, Domain]> {
    return validateApiAttesterSlashing(this.chain, attesterSlashing);
  }

  importAttesterSlashing(
    fork: ForkName,
    attesterSlashing: AttesterSlashing,
    verifiedDomains: [Domain, Domain],
    opts: {addToForkChoice: boolean}
  ): void {
    this.chain.opPool.insertAttesterSlashing(fork, attesterSlashing, verifiedDomains);
    if (opts.addToForkChoice) {
      this.chain.forkChoice.onAttesterSlashing(attesterSlashing);
    }
  }

  validateGossipProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<Domain> {
    return validateGossipProposerSlashing(this.chain, proposerSlashing);
  }

  validateApiProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<Domain> {
    return validateApiProposerSlashing(this.chain, proposerSlashing);
  }

  importProposerSlashing(proposerSlashing: phase0.ProposerSlashing, verifiedDomain: Domain): void {
    this.chain.opPool.insertProposerSlashing(proposerSlashing, verifiedDomain);
  }

  validateGossipVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<void> {
    return validateGossipVoluntaryExit(this.chain, voluntaryExit);
  }

  validateApiVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<ApiVoluntaryExitResult> {
    return validateApiVoluntaryExit(this.chain, voluntaryExit);
  }

  importVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): void {
    this.chain.opPool.insertVoluntaryExit(voluntaryExit);
  }

  deferVoluntaryExit(
    voluntaryExit: phase0.SignedVoluntaryExit,
    validity: VoluntaryExitValidity,
    currentEpoch: Epoch
  ): boolean {
    return this.chain.deferredVoluntaryExitPool.insert(voluntaryExit, validity, currentEpoch);
  }

  validateGossipBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): Promise<void> {
    return validateGossipBlsToExecutionChange(this.chain, blsToExecutionChange);
  }

  validateApiBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): Promise<void> {
    return validateApiBlsToExecutionChange(this.chain, blsToExecutionChange);
  }

  importBlsToExecutionChange(
    blsToExecutionChange: capella.SignedBLSToExecutionChange,
    opts: {preCapella?: boolean}
  ): void {
    this.chain.opPool.insertBlsToExecutionChange(blsToExecutionChange, opts.preCapella);
  }

  validateGossipPayloadAttestationMessage(
    message: gloas.PayloadAttestationMessage
  ): Promise<PayloadAttestationValidationResult> {
    return validateGossipPayloadAttestationMessage(this.chain, message);
  }

  validateApiPayloadAttestationMessage(
    message: gloas.PayloadAttestationMessage
  ): Promise<PayloadAttestationValidationResult> {
    return validateApiPayloadAttestationMessage(this.chain, message);
  }

  importPayloadAttestationMessage(
    message: gloas.PayloadAttestationMessage,
    result: PayloadAttestationValidationResult,
    opts: {addToPool: boolean; addToForkChoice: boolean}
  ): InsertOutcome | null {
    let insertOutcome: InsertOutcome | null = null;
    if (opts.addToPool) {
      try {
        insertOutcome = this.chain.payloadAttestationPool.add(
          message,
          result.attDataRootHex,
          result.validatorCommitteeIndices
        );
      } catch (e) {
        this.chain.logger.debug("Error adding to payloadAttestation pool", {slot: message.data.slot}, e as Error);
      }
    }

    if (opts.addToForkChoice) {
      this.chain.forkChoice.notifyPtcMessages(
        toRootHex(message.data.beaconBlockRoot),
        message.data.slot,
        result.validatorCommitteeIndices,
        message.data.payloadPresent,
        message.data.blobDataAvailable
      );
    }

    return insertOutcome;
  }

  validateGossipExecutionPayloadBid(
    bid: gloas.SignedExecutionPayloadBid
  ): Promise<ExecutionPayloadBidValidationResult> {
    return validateGossipExecutionPayloadBid(this.chain, bid);
  }

  validateApiExecutionPayloadBid(bid: gloas.SignedExecutionPayloadBid): Promise<ExecutionPayloadBidValidationResult> {
    return validateGossipExecutionPayloadBid(this.chain, bid);
  }

  importExecutionPayloadBid(bid: gloas.SignedExecutionPayloadBid, opts: {receivedMs: number}): InsertOutcome {
    return this.chain.executionPayloadBidPool.add(bid, opts.receivedMs);
  }

  validateGossipProposerPreferences(signedProposerPreferences: gloas.SignedProposerPreferences): Promise<void> {
    return validateGossipProposerPreferences(this.chain, signedProposerPreferences);
  }

  validateApiProposerPreferences(signedProposerPreferences: gloas.SignedProposerPreferences): Promise<void> {
    return validateGossipProposerPreferences(this.chain, signedProposerPreferences);
  }

  validateGossipInclusionList(signedInclusionList: heze.SignedInclusionList): Promise<InclusionListValidationResult> {
    return validateGossipInclusionList(this.chain, signedInclusionList);
  }

  validateApiInclusionList(signedInclusionList: heze.SignedInclusionList): Promise<InclusionListValidationResult> {
    return validateGossipInclusionList(this.chain, signedInclusionList);
  }

  importInclusionList(
    signedInclusionList: heze.SignedInclusionList,
    result: InclusionListValidationResult,
    opts: {isTimely: boolean}
  ): InclusionListInsertOutcome {
    return this.chain.inclusionListStore.process(signedInclusionList, result.committeeIndices, opts.isTimely);
  }

  validateGossipBlock(fork: ForkName, signedBlock: SignedBeaconBlock): Promise<GossipBlockValidationResult> {
    return validateGossipBlock(this.chain.config, this.chain, signedBlock, fork);
  }

  validateApiBlock(fork: ForkName, signedBlock: SignedBeaconBlock): Promise<GossipBlockValidationResult> {
    return validateGossipBlock(this.chain.config, this.chain, signedBlock, fork);
  }

  validateGossipBlockWithUnknownParent(signedBlock: SignedBeaconBlock, blockRootHex: RootHex): Promise<void> {
    return validateGossipBlockWithUnknownParent(this.chain, signedBlock, blockRootHex);
  }

  verifyBlockProposerSignature(
    signedBlock: SignedBeaconBlock,
    blockRootHex: RootHex,
    opts?: {verifyOnMainThread?: boolean}
  ): Promise<void> {
    return verifyBlockProposerSignature(this.chain, signedBlock, blockRootHex, opts);
  }

  validateGossipExecutionPayloadEnvelope(signedEnvelope: gloas.SignedExecutionPayloadEnvelope): Promise<void> {
    return validateGossipExecutionPayloadEnvelope(this.chain, signedEnvelope);
  }

  validateApiExecutionPayloadEnvelope(signedEnvelope: gloas.SignedExecutionPayloadEnvelope): Promise<void> {
    return validateApiExecutionPayloadEnvelope(this.chain, signedEnvelope);
  }

  validateGossipBlobSidecar(fork: ForkName, blobSidecar: deneb.BlobSidecar, subnet: SubnetID): Promise<void> {
    return validateGossipBlobSidecar(fork, this.chain, blobSidecar, subnet);
  }

  validateGossipFuluDataColumnSidecar(dataColumnSidecar: fulu.DataColumnSidecar, subnet: SubnetID): Promise<void> {
    return validateGossipFuluDataColumnSidecar(this.chain, dataColumnSidecar, subnet, this.chain.metrics);
  }

  validateGossipGloasDataColumnSidecar(
    payloadInput: PayloadEnvelopeInput,
    dataColumnSidecar: gloas.DataColumnSidecar,
    subnet: SubnetID
  ): Promise<void> {
    return validateGossipGloasDataColumnSidecar(
      this.chain,
      payloadInput,
      dataColumnSidecar,
      subnet,
      this.chain.metrics
    );
  }

  getAggregatedAttestation(slot: Slot, attDataRootHex: RootHex, committeeIndex: CommitteeIndex): Attestation | null {
    return this.chain.attestationPool.getAggregate(slot, attDataRootHex, committeeIndex);
  }

  getPooledAttestations(slot?: Slot): Attestation[] {
    return this.chain.attestationPool.getAll(slot);
  }

  getAttestationsForBlock(fork: ForkName, state: IBeaconStateView): Attestation[] {
    return this.chain.aggregatedAttestationPool.getAttestationsForBlock(
      fork,
      this.chain.forkChoice,
      this.chain.stateEngine,
      state
    );
  }

  getPooledAggregates(slot?: Slot): Attestation[] {
    return this.chain.aggregatedAttestationPool.getAll(slot);
  }

  getSyncCommitteeContribution(
    subcommitteeIndex: SubcommitteeIndex,
    slot: Slot,
    beaconBlockRoot: Root
  ): altair.SyncCommitteeContribution | null {
    return this.chain.syncCommitteeMessagePool.getContribution(subcommitteeIndex, slot, beaconBlockRoot);
  }

  getSyncAggregate(slot: Slot, beaconBlockRoot: Root): altair.SyncAggregate {
    return this.chain.syncContributionAndProofPool.getAggregate(slot, beaconBlockRoot);
  }

  getSlashingsAndExits(
    state: IBeaconStateView,
    blockType: BlockType
  ): [
    AttesterSlashing[],
    phase0.ProposerSlashing[],
    phase0.SignedVoluntaryExit[],
    capella.SignedBLSToExecutionChange[],
  ] {
    return this.chain.opPool.getSlashingsAndExits(state, blockType, this.chain.metrics);
  }

  getPooledAttesterSlashings(): AttesterSlashing[] {
    return this.chain.opPool.getAllAttesterSlashings();
  }

  getPooledProposerSlashings(): phase0.ProposerSlashing[] {
    return this.chain.opPool.getAllProposerSlashings();
  }

  getPooledVoluntaryExits(): phase0.SignedVoluntaryExit[] {
    return this.chain.opPool.getAllVoluntaryExits();
  }

  getPooledBlsToExecutionChanges(): capella.SignedBLSToExecutionChange[] {
    return this.chain.opPool.getAllBlsToExecutionChanges().map(({data}) => data);
  }

  hasSeenProposerSlashing(validatorIndex: ValidatorIndex): boolean {
    return this.chain.opPool.hasSeenProposerSlashing(validatorIndex);
  }

  drainProcessableVoluntaryExits(state: IBeaconStateView): phase0.SignedVoluntaryExit[] {
    return this.chain.deferredVoluntaryExitPool.drainProcessableExits(state);
  }

  getPayloadAttestationsForBlock(beaconBlockRootHex: RootHex, slot: Slot): gloas.PayloadAttestation[] {
    return this.chain.payloadAttestationPool.getPayloadAttestationsForBlock(beaconBlockRootHex, slot);
  }

  getPooledPayloadAttestations(slot?: Slot): gloas.PayloadAttestation[] {
    return this.chain.payloadAttestationPool.getAll(slot);
  }

  getBestExecutionPayloadBid(
    slot: Slot,
    parentBlockHash: RootHex | null,
    parentBlockRoot: RootHex
  ): PooledExecutionPayloadBid | null {
    return this.chain.executionPayloadBidPool.getBestBid(slot, parentBlockHash, parentBlockRoot);
  }

  getProposerPreferences(slot: Slot, dependentRootHex: RootHex): gloas.SignedProposerPreferences | null {
    return this.chain.proposerPreferencesPool.get(slot, dependentRootHex);
  }

  getAllProposerPreferences(slot?: Slot, dependentRootHex?: RootHex): gloas.SignedProposerPreferences[] {
    return this.chain.proposerPreferencesPool.getAll(slot, dependentRootHex);
  }

  getInclusionListTransactions(slot: Slot, dependentRootHex: RootHex, onlyTimely?: boolean): bellatrix.Transactions {
    return this.chain.inclusionListStore.getInclusionListTransactions(slot, dependentRootHex, onlyTimely);
  }

  getInclusionListBits(slot: Slot, dependentRootHex: RootHex, onlyTimely?: boolean): BitArray {
    return this.chain.inclusionListStore.getInclusionListBits(slot, dependentRootHex, onlyTimely);
  }

  isInclusionListBitsInclusive(slot: Slot, dependentRootHex: RootHex, bits: BitArray): boolean {
    return this.chain.inclusionListStore.isInclusionListBitsInclusive(slot, dependentRootHex, bits);
  }

  getInclusionListsByIndices(slot: Slot, dependentRootHex: RootHex, indices: BitArray): heze.SignedInclusionList[] {
    return this.chain.inclusionListStore.getByIndices(slot, dependentRootHex, indices);
  }

  isBlockProposerKnown(slot: Slot, proposerIndex: ValidatorIndex): boolean {
    return this.chain.seenBlockProposers.isKnown(slot, proposerIndex);
  }

  hasSeenBlockRoot(slot: Slot, proposerIndex: ValidatorIndex, blockRootHex: RootHex): boolean {
    return this.chain.seenBlockProposers.hasBlockRoot(slot, proposerIndex, blockRootHex);
  }

  isProposerEquivocating(slot: Slot, proposerIndex: ValidatorIndex): boolean {
    return this.chain.seenBlockProposers.isEquivocating(slot, proposerIndex);
  }

  getConflictingBlockRoots(slot: Slot, proposerIndex: ValidatorIndex, blockRootHex: RootHex): RootHex[] {
    return this.chain.seenBlockProposers.getConflictingBlockRoots(slot, proposerIndex, blockRootHex);
  }

  getProposerEquivocationHeaders(
    slot: Slot,
    proposerIndex: ValidatorIndex
  ): [phase0.SignedBeaconBlockHeader, phase0.SignedBeaconBlockHeader] | null {
    return this.chain.seenBlockProposers.getEquivocationHeaders(slot, proposerIndex);
  }

  validatorSeenAtEpoch(validatorIndex: ValidatorIndex, epoch: Epoch): boolean {
    // Caller must check that epoch is not older than current epoch - 1, else the caches may already be pruned
    return (
      this.chain.seenBlockAttesters.isKnown(epoch, validatorIndex) ||
      this.chain.seenAttesters.isKnown(epoch, validatorIndex) ||
      this.chain.seenAggregators.isKnown(epoch, validatorIndex) ||
      this.chain.seenPayloadAttesters.seenAtEpoch(epoch, validatorIndex) ||
      this.chain.seenBlockProposers.seenAtEpoch(epoch, validatorIndex)
    );
  }
}

/** Sends each topic to the native engine when it is enabled for that topic, otherwise to the JS engine */
export class TopicRoutedValidationEngine implements IValidationEngine {
  constructor(
    private readonly js: IValidationEngine,
    private readonly native: IValidationEngine,
    private readonly nativeTopics: ReadonlySet<ValidationTopic>
  ) {}

  onSlot(slot: Slot): void {
    this.js.onSlot(slot);
    this.native.onSlot(slot);
  }

  onEpoch(epoch: Epoch): void {
    this.js.onEpoch(epoch);
    this.native.onEpoch(epoch);
  }

  onNewHead(headSlot: Slot): void {
    this.js.onNewHead(headSlot);
    this.native.onNewHead(headSlot);
  }

  onFinalized(finalizedSlot: Slot): void {
    this.js.onFinalized(finalizedSlot);
    this.native.onFinalized(finalizedSlot);
  }

  onBlockVerified(signedBlock: SignedBeaconBlock, blockRootHex: RootHex): void {
    this.js.onBlockVerified(signedBlock, blockRootHex);
    this.native.onBlockVerified(signedBlock, blockRootHex);
  }

  onBlockImported(block: BeaconBlock, blockRootHex: RootHex): void {
    this.js.onBlockImported(block, blockRootHex);
    this.native.onBlockImported(block, blockRootHex);
  }

  onBlockAttestationImported(
    fork: ForkName,
    state: IBeaconStateView,
    blockEpoch: Epoch,
    target: phase0.Checkpoint,
    attDataRootHex: RootHex,
    attestation: Attestation,
    indexedAttestation: IndexedAttestation
  ): void {
    for (const engine of [this.js, this.native]) {
      engine.onBlockAttestationImported(
        fork,
        state,
        blockEpoch,
        target,
        attDataRootHex,
        attestation,
        indexedAttestation
      );
    }
  }

  close(): void {
    this.js.close();
    this.native.close();
  }

  validateGossipAttestationsSameAttData(fork: ForkName, attestations: GossipAttestation[]): Promise<BatchResult> {
    return this.engineFor(ValidationTopic.attestation).validateGossipAttestationsSameAttData(fork, attestations);
  }

  validateApiAttestation(fork: ForkName, attestation: ApiAttestation): Promise<AttestationValidationResult> {
    return this.engineFor(ValidationTopic.attestation).validateApiAttestation(fork, attestation);
  }

  importAttestation(result: AttestationValidationResult, opts: ImportAttestationOpts): InsertOutcome | null {
    return this.engineFor(ValidationTopic.attestation).importAttestation(result, opts);
  }

  validateGossipAggregateAndProof(
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof,
    serializedData: Uint8Array
  ): Promise<AggregateAndProofValidationResult> {
    return this.engineFor(ValidationTopic.aggregate).validateGossipAggregateAndProof(
      fork,
      signedAggregateAndProof,
      serializedData
    );
  }

  validateApiAggregateAndProof(
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<AggregateAndProofValidationResult> {
    return this.engineFor(ValidationTopic.aggregate).validateApiAggregateAndProof(fork, signedAggregateAndProof);
  }

  importAggregateAndProof(
    signedAggregateAndProof: SignedAggregateAndProof,
    result: AggregateAndProofValidationResult,
    opts: {addToForkChoice: boolean}
  ): InsertOutcome {
    return this.engineFor(ValidationTopic.aggregate).importAggregateAndProof(signedAggregateAndProof, result, opts);
  }

  validateGossipSyncCommitteeMessage(
    message: altair.SyncCommitteeMessage,
    subnet: SubnetID
  ): Promise<SyncCommitteeMessageValidationResult> {
    return this.engineFor(ValidationTopic.syncCommitteeMessage).validateGossipSyncCommitteeMessage(message, subnet);
  }

  validateApiSyncCommitteeMessage(message: altair.SyncCommitteeMessage): Promise<SyncCommitteeMessageValidationResult> {
    return this.engineFor(ValidationTopic.syncCommitteeMessage).validateApiSyncCommitteeMessage(message);
  }

  importSyncCommitteeMessage(
    message: altair.SyncCommitteeMessage,
    result: SyncCommitteeMessageValidationResult,
    opts: {priority?: boolean}
  ): InsertOutcome[] {
    return this.engineFor(ValidationTopic.syncCommitteeMessage).importSyncCommitteeMessage(message, result, opts);
  }

  validateGossipContributionAndProof(
    signedContributionAndProof: altair.SignedContributionAndProof
  ): Promise<ContributionAndProofValidationResult> {
    return this.engineFor(ValidationTopic.contributionAndProof).validateGossipContributionAndProof(
      signedContributionAndProof
    );
  }

  validateApiContributionAndProof(
    signedContributionAndProof: altair.SignedContributionAndProof
  ): Promise<ContributionAndProofValidationResult> {
    return this.engineFor(ValidationTopic.contributionAndProof).validateApiContributionAndProof(
      signedContributionAndProof
    );
  }

  importContributionAndProof(
    signedContributionAndProof: altair.SignedContributionAndProof,
    result: ContributionAndProofValidationResult,
    opts: {priority?: boolean}
  ): InsertOutcome {
    return this.engineFor(ValidationTopic.contributionAndProof).importContributionAndProof(
      signedContributionAndProof,
      result,
      opts
    );
  }

  validateGossipAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<[Domain, Domain]> {
    return this.engineFor(ValidationTopic.operations).validateGossipAttesterSlashing(attesterSlashing);
  }

  validateApiAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<[Domain, Domain]> {
    return this.engineFor(ValidationTopic.operations).validateApiAttesterSlashing(attesterSlashing);
  }

  importAttesterSlashing(
    fork: ForkName,
    attesterSlashing: AttesterSlashing,
    verifiedDomains: [Domain, Domain],
    opts: {addToForkChoice: boolean}
  ): void {
    this.engineFor(ValidationTopic.operations).importAttesterSlashing(fork, attesterSlashing, verifiedDomains, opts);
  }

  validateGossipProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<Domain> {
    return this.engineFor(ValidationTopic.operations).validateGossipProposerSlashing(proposerSlashing);
  }

  validateApiProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<Domain> {
    return this.engineFor(ValidationTopic.operations).validateApiProposerSlashing(proposerSlashing);
  }

  importProposerSlashing(proposerSlashing: phase0.ProposerSlashing, verifiedDomain: Domain): void {
    this.engineFor(ValidationTopic.operations).importProposerSlashing(proposerSlashing, verifiedDomain);
  }

  validateGossipVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<void> {
    return this.engineFor(ValidationTopic.operations).validateGossipVoluntaryExit(voluntaryExit);
  }

  validateApiVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<ApiVoluntaryExitResult> {
    return this.engineFor(ValidationTopic.operations).validateApiVoluntaryExit(voluntaryExit);
  }

  importVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): void {
    this.engineFor(ValidationTopic.operations).importVoluntaryExit(voluntaryExit);
  }

  deferVoluntaryExit(
    voluntaryExit: phase0.SignedVoluntaryExit,
    validity: VoluntaryExitValidity,
    currentEpoch: Epoch
  ): boolean {
    return this.engineFor(ValidationTopic.operations).deferVoluntaryExit(voluntaryExit, validity, currentEpoch);
  }

  validateGossipBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): Promise<void> {
    return this.engineFor(ValidationTopic.operations).validateGossipBlsToExecutionChange(blsToExecutionChange);
  }

  validateApiBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): Promise<void> {
    return this.engineFor(ValidationTopic.operations).validateApiBlsToExecutionChange(blsToExecutionChange);
  }

  importBlsToExecutionChange(
    blsToExecutionChange: capella.SignedBLSToExecutionChange,
    opts: {preCapella?: boolean}
  ): void {
    this.engineFor(ValidationTopic.operations).importBlsToExecutionChange(blsToExecutionChange, opts);
  }

  validateGossipPayloadAttestationMessage(
    message: gloas.PayloadAttestationMessage
  ): Promise<PayloadAttestationValidationResult> {
    return this.engineFor(ValidationTopic.payloadAttestation).validateGossipPayloadAttestationMessage(message);
  }

  validateApiPayloadAttestationMessage(
    message: gloas.PayloadAttestationMessage
  ): Promise<PayloadAttestationValidationResult> {
    return this.engineFor(ValidationTopic.payloadAttestation).validateApiPayloadAttestationMessage(message);
  }

  importPayloadAttestationMessage(
    message: gloas.PayloadAttestationMessage,
    result: PayloadAttestationValidationResult,
    opts: {addToPool: boolean; addToForkChoice: boolean}
  ): InsertOutcome | null {
    return this.engineFor(ValidationTopic.payloadAttestation).importPayloadAttestationMessage(message, result, opts);
  }

  validateGossipExecutionPayloadBid(
    bid: gloas.SignedExecutionPayloadBid
  ): Promise<ExecutionPayloadBidValidationResult> {
    return this.engineFor(ValidationTopic.executionPayloadBid).validateGossipExecutionPayloadBid(bid);
  }

  validateApiExecutionPayloadBid(bid: gloas.SignedExecutionPayloadBid): Promise<ExecutionPayloadBidValidationResult> {
    return this.engineFor(ValidationTopic.executionPayloadBid).validateApiExecutionPayloadBid(bid);
  }

  importExecutionPayloadBid(bid: gloas.SignedExecutionPayloadBid, opts: {receivedMs: number}): InsertOutcome {
    return this.engineFor(ValidationTopic.executionPayloadBid).importExecutionPayloadBid(bid, opts);
  }

  validateGossipProposerPreferences(signedProposerPreferences: gloas.SignedProposerPreferences): Promise<void> {
    return this.engineFor(ValidationTopic.proposerPreferences).validateGossipProposerPreferences(
      signedProposerPreferences
    );
  }

  validateApiProposerPreferences(signedProposerPreferences: gloas.SignedProposerPreferences): Promise<void> {
    return this.engineFor(ValidationTopic.proposerPreferences).validateApiProposerPreferences(
      signedProposerPreferences
    );
  }

  validateGossipInclusionList(signedInclusionList: heze.SignedInclusionList): Promise<InclusionListValidationResult> {
    return this.engineFor(ValidationTopic.inclusionList).validateGossipInclusionList(signedInclusionList);
  }

  validateApiInclusionList(signedInclusionList: heze.SignedInclusionList): Promise<InclusionListValidationResult> {
    return this.engineFor(ValidationTopic.inclusionList).validateApiInclusionList(signedInclusionList);
  }

  importInclusionList(
    signedInclusionList: heze.SignedInclusionList,
    result: InclusionListValidationResult,
    opts: {isTimely: boolean}
  ): InclusionListInsertOutcome {
    return this.engineFor(ValidationTopic.inclusionList).importInclusionList(signedInclusionList, result, opts);
  }

  validateGossipBlock(fork: ForkName, signedBlock: SignedBeaconBlock): Promise<GossipBlockValidationResult> {
    return this.engineFor(ValidationTopic.block).validateGossipBlock(fork, signedBlock);
  }

  validateApiBlock(fork: ForkName, signedBlock: SignedBeaconBlock): Promise<GossipBlockValidationResult> {
    return this.engineFor(ValidationTopic.block).validateApiBlock(fork, signedBlock);
  }

  validateGossipBlockWithUnknownParent(signedBlock: SignedBeaconBlock, blockRootHex: RootHex): Promise<void> {
    return this.engineFor(ValidationTopic.block).validateGossipBlockWithUnknownParent(signedBlock, blockRootHex);
  }

  verifyBlockProposerSignature(
    signedBlock: SignedBeaconBlock,
    blockRootHex: RootHex,
    opts?: {verifyOnMainThread?: boolean}
  ): Promise<void> {
    return this.engineFor(ValidationTopic.block).verifyBlockProposerSignature(signedBlock, blockRootHex, opts);
  }

  validateGossipExecutionPayloadEnvelope(signedEnvelope: gloas.SignedExecutionPayloadEnvelope): Promise<void> {
    return this.engineFor(ValidationTopic.executionPayloadEnvelope).validateGossipExecutionPayloadEnvelope(
      signedEnvelope
    );
  }

  validateApiExecutionPayloadEnvelope(signedEnvelope: gloas.SignedExecutionPayloadEnvelope): Promise<void> {
    return this.engineFor(ValidationTopic.executionPayloadEnvelope).validateApiExecutionPayloadEnvelope(signedEnvelope);
  }

  validateGossipBlobSidecar(fork: ForkName, blobSidecar: deneb.BlobSidecar, subnet: SubnetID): Promise<void> {
    return this.engineFor(ValidationTopic.blobSidecar).validateGossipBlobSidecar(fork, blobSidecar, subnet);
  }

  validateGossipFuluDataColumnSidecar(dataColumnSidecar: fulu.DataColumnSidecar, subnet: SubnetID): Promise<void> {
    return this.engineFor(ValidationTopic.dataColumnSidecar).validateGossipFuluDataColumnSidecar(
      dataColumnSidecar,
      subnet
    );
  }

  validateGossipGloasDataColumnSidecar(
    payloadInput: PayloadEnvelopeInput,
    dataColumnSidecar: gloas.DataColumnSidecar,
    subnet: SubnetID
  ): Promise<void> {
    return this.engineFor(ValidationTopic.dataColumnSidecar).validateGossipGloasDataColumnSidecar(
      payloadInput,
      dataColumnSidecar,
      subnet
    );
  }

  getAggregatedAttestation(slot: Slot, attDataRootHex: RootHex, committeeIndex: CommitteeIndex): Attestation | null {
    return this.engineFor(ValidationTopic.attestation).getAggregatedAttestation(slot, attDataRootHex, committeeIndex);
  }

  getPooledAttestations(slot?: Slot): Attestation[] {
    return this.engineFor(ValidationTopic.attestation).getPooledAttestations(slot);
  }

  getAttestationsForBlock(fork: ForkName, state: IBeaconStateView): Attestation[] {
    return this.engineFor(ValidationTopic.aggregate).getAttestationsForBlock(fork, state);
  }

  getPooledAggregates(slot?: Slot): Attestation[] {
    return this.engineFor(ValidationTopic.aggregate).getPooledAggregates(slot);
  }

  getSyncCommitteeContribution(
    subcommitteeIndex: SubcommitteeIndex,
    slot: Slot,
    beaconBlockRoot: Root
  ): altair.SyncCommitteeContribution | null {
    return this.engineFor(ValidationTopic.syncCommitteeMessage).getSyncCommitteeContribution(
      subcommitteeIndex,
      slot,
      beaconBlockRoot
    );
  }

  getSyncAggregate(slot: Slot, beaconBlockRoot: Root): altair.SyncAggregate {
    return this.engineFor(ValidationTopic.contributionAndProof).getSyncAggregate(slot, beaconBlockRoot);
  }

  getSlashingsAndExits(
    state: IBeaconStateView,
    blockType: BlockType
  ): [
    AttesterSlashing[],
    phase0.ProposerSlashing[],
    phase0.SignedVoluntaryExit[],
    capella.SignedBLSToExecutionChange[],
  ] {
    return this.engineFor(ValidationTopic.operations).getSlashingsAndExits(state, blockType);
  }

  getPooledAttesterSlashings(): AttesterSlashing[] {
    return this.engineFor(ValidationTopic.operations).getPooledAttesterSlashings();
  }

  getPooledProposerSlashings(): phase0.ProposerSlashing[] {
    return this.engineFor(ValidationTopic.operations).getPooledProposerSlashings();
  }

  getPooledVoluntaryExits(): phase0.SignedVoluntaryExit[] {
    return this.engineFor(ValidationTopic.operations).getPooledVoluntaryExits();
  }

  getPooledBlsToExecutionChanges(): capella.SignedBLSToExecutionChange[] {
    return this.engineFor(ValidationTopic.operations).getPooledBlsToExecutionChanges();
  }

  hasSeenProposerSlashing(validatorIndex: ValidatorIndex): boolean {
    return this.engineFor(ValidationTopic.operations).hasSeenProposerSlashing(validatorIndex);
  }

  drainProcessableVoluntaryExits(state: IBeaconStateView): phase0.SignedVoluntaryExit[] {
    return this.engineFor(ValidationTopic.operations).drainProcessableVoluntaryExits(state);
  }

  getPayloadAttestationsForBlock(beaconBlockRootHex: RootHex, slot: Slot): gloas.PayloadAttestation[] {
    return this.engineFor(ValidationTopic.payloadAttestation).getPayloadAttestationsForBlock(beaconBlockRootHex, slot);
  }

  getPooledPayloadAttestations(slot?: Slot): gloas.PayloadAttestation[] {
    return this.engineFor(ValidationTopic.payloadAttestation).getPooledPayloadAttestations(slot);
  }

  getBestExecutionPayloadBid(
    slot: Slot,
    parentBlockHash: RootHex | null,
    parentBlockRoot: RootHex
  ): PooledExecutionPayloadBid | null {
    return this.engineFor(ValidationTopic.executionPayloadBid).getBestExecutionPayloadBid(
      slot,
      parentBlockHash,
      parentBlockRoot
    );
  }

  getProposerPreferences(slot: Slot, dependentRootHex: RootHex): gloas.SignedProposerPreferences | null {
    return this.engineFor(ValidationTopic.proposerPreferences).getProposerPreferences(slot, dependentRootHex);
  }

  getAllProposerPreferences(slot?: Slot, dependentRootHex?: RootHex): gloas.SignedProposerPreferences[] {
    return this.engineFor(ValidationTopic.proposerPreferences).getAllProposerPreferences(slot, dependentRootHex);
  }

  getInclusionListTransactions(slot: Slot, dependentRootHex: RootHex, onlyTimely?: boolean): bellatrix.Transactions {
    return this.engineFor(ValidationTopic.inclusionList).getInclusionListTransactions(
      slot,
      dependentRootHex,
      onlyTimely
    );
  }

  getInclusionListBits(slot: Slot, dependentRootHex: RootHex, onlyTimely?: boolean): BitArray {
    return this.engineFor(ValidationTopic.inclusionList).getInclusionListBits(slot, dependentRootHex, onlyTimely);
  }

  isInclusionListBitsInclusive(slot: Slot, dependentRootHex: RootHex, bits: BitArray): boolean {
    return this.engineFor(ValidationTopic.inclusionList).isInclusionListBitsInclusive(slot, dependentRootHex, bits);
  }

  getInclusionListsByIndices(slot: Slot, dependentRootHex: RootHex, indices: BitArray): heze.SignedInclusionList[] {
    return this.engineFor(ValidationTopic.inclusionList).getInclusionListsByIndices(slot, dependentRootHex, indices);
  }

  isBlockProposerKnown(slot: Slot, proposerIndex: ValidatorIndex): boolean {
    return this.engineFor(ValidationTopic.block).isBlockProposerKnown(slot, proposerIndex);
  }

  hasSeenBlockRoot(slot: Slot, proposerIndex: ValidatorIndex, blockRootHex: RootHex): boolean {
    return this.engineFor(ValidationTopic.block).hasSeenBlockRoot(slot, proposerIndex, blockRootHex);
  }

  isProposerEquivocating(slot: Slot, proposerIndex: ValidatorIndex): boolean {
    return this.engineFor(ValidationTopic.block).isProposerEquivocating(slot, proposerIndex);
  }

  getConflictingBlockRoots(slot: Slot, proposerIndex: ValidatorIndex, blockRootHex: RootHex): RootHex[] {
    return this.engineFor(ValidationTopic.block).getConflictingBlockRoots(slot, proposerIndex, blockRootHex);
  }

  getProposerEquivocationHeaders(
    slot: Slot,
    proposerIndex: ValidatorIndex
  ): [phase0.SignedBeaconBlockHeader, phase0.SignedBeaconBlockHeader] | null {
    return this.engineFor(ValidationTopic.block).getProposerEquivocationHeaders(slot, proposerIndex);
  }

  validatorSeenAtEpoch(validatorIndex: ValidatorIndex, epoch: Epoch): boolean {
    return (
      this.js.validatorSeenAtEpoch(validatorIndex, epoch) || this.native.validatorSeenAtEpoch(validatorIndex, epoch)
    );
  }

  private engineFor(topic: ValidationTopic): IValidationEngine {
    return this.nativeTopics.has(topic) ? this.native : this.js;
  }
}
