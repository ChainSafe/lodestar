import {IGossipMessageValidator} from "./interface";
import {
  Attestation,
  AttesterSlashing,
  ProposerSlashing,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  SignedVoluntaryExit,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../db";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  computeSubnetForAttestation,
  getAttestingIndices,
  getCurrentSlot,
  getDomain,
  getIndexedAttestation,
  isAggregator,
  isValidAttesterSlashing,
  isValidIndexedAttestation,
  isValidProposerSlashing,
  isValidVoluntaryExit,
  verifyBlockSignature
} from "@chainsafe/lodestar-beacon-state-transition";
import {processSlots,} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_PROPAGATION_SLOT_RANGE, DomainType, MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../constants";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconChain} from "../../chain";
import {verify} from "@chainsafe/bls";
import {arrayIntersection, sszEqualPredicate} from "../../util/objects";
import {hasValidAttestationSlot, validateAttestation} from "../../util/validation/attestation";

/* eslint-disable @typescript-eslint/interface-name-prefix */
interface GossipMessageValidatorModules {
  chain: IBeaconChain;
  db: IBeaconDb;
  config: IBeaconConfig;
  logger: ILogger;
}

export class GossipMessageValidator implements IGossipMessageValidator {
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;

  public constructor({chain, db, config, logger}: GossipMessageValidatorModules) {
    this.chain = chain;
    this.db = db;
    this.config = config;
    this.logger = logger;
  }

  public isValidIncomingBlock = async (signedBlock: SignedBeaconBlock): Promise<boolean> => {
    const finalizedCheckpoint = await this.chain.getFinalizedCheckpoint();
    const slot = signedBlock.message.slot;
    // block is too old
    if (slot <= computeStartSlotAtEpoch(this.config, finalizedCheckpoint.epoch)) {
      return false;
    }

    const parentBlock = await this.db.block.get(signedBlock.message.parentRoot.valueOf() as Uint8Array);
    if(!parentBlock) {
      return false;
    }
    const {state, epochCtx} = await this.db.stateCache.get(parentBlock.message.stateRoot);
    // block is not in the future
    const milliSecPerSlot = this.config.params.SECONDS_PER_SLOT * 1000;
    if (signedBlock.message.slot * milliSecPerSlot >
        getCurrentSlot(this.config, state.genesisTime) * milliSecPerSlot + MAXIMUM_GOSSIP_CLOCK_DISPARITY) {
      return false;
    }
    const root = this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
    // skip block if its a known bad block
    if (await this.db.badBlock.has(root)) {
      this.logger.warn(`Received bad block, block root : ${root} `);
      return false;
    }

    const existingBlock = await this.chain.getBlockAtSlot(signedBlock.message.slot);
    if (existingBlock && existingBlock.message.proposerIndex === signedBlock.message.proposerIndex) {
      // same proposer submitted twice
      return false;
    }

    if (state.slot < slot) {
      processSlots(epochCtx, state, slot);
    }

    if (!verifyBlockSignature(this.config, state, signedBlock)) {
      return false;
    }
    const supposedProposerIndex = epochCtx.getBeaconProposer(signedBlock.message.slot);
    return supposedProposerIndex === signedBlock.message.proposerIndex;
  };

  public isValidIncomingCommitteeAttestation = async (attestation: Attestation, subnet: number): Promise<boolean> => {
    const {state, epochCtx} = await this.chain.getHeadStateContext();
    if(!hasValidAttestationSlot(this.config, state.genesisTime, attestation)) {
      return false;
    }
    if (state.slot < attestation.data.slot) {
      processSlots(epochCtx, state, attestation.data.slot);
    }
    if (subnet !== computeSubnetForAttestation(this.config, state, attestation)) {
      return false;
    }
    try {
      await validateAttestation(this.config, this.db, state, epochCtx, attestation);
      return true;
    } catch (e) {
      return false;
    }
  };

  public isValidIncomingAggregateAndProof =
  async (signedAggregationAndProof: SignedAggregateAndProof): Promise<boolean> => {
    const aggregateAndProof = signedAggregationAndProof.message;
    const aggregate = aggregateAndProof.aggregate;
    const attestationData = aggregate.data;
    const slot = attestationData.slot;
    const {state, epochCtx} = await this.chain.getHeadStateContext();
    const currentSlot = getCurrentSlot(this.config, state.genesisTime);
    const milliSecPerSlot = this.config.params.SECONDS_PER_SLOT * 1000;
    const currentSlotTime = currentSlot * milliSecPerSlot;
    if (!((slot + ATTESTATION_PROPAGATION_SLOT_RANGE) * milliSecPerSlot + MAXIMUM_GOSSIP_CLOCK_DISPARITY
        >= currentSlotTime && currentSlotTime >= slot * milliSecPerSlot - MAXIMUM_GOSSIP_CLOCK_DISPARITY)) {
      return false;
    }
    if (state.slot < slot) {
      processSlots(epochCtx, state, slot);
    }

    if (await this.db.aggregateAndProof.hasAttestation(aggregate)) {
      return false;
    }

    const aggregatorIndex = aggregateAndProof.aggregatorIndex;
    const existingAttestations = await this.db.aggregateAndProof.getByAggregatorAndEpoch(
      aggregatorIndex, attestationData.target.epoch) || [];
    if (existingAttestations.length > 0) {
      return false;
    }

    if (getAttestingIndices(this.config, state, attestationData, aggregate.aggregationBits).length < 1) {
      return false;
    }

    const blockRoot = aggregate.data.beaconBlockRoot.valueOf() as Uint8Array;
    if (!this.chain.forkChoice.hasBlock(blockRoot) || await this.db.badBlock.has(blockRoot)) {
      return false;
    }

    const selectionProof = aggregateAndProof.selectionProof;
    if (!isAggregator(this.config, state, slot, attestationData.index, selectionProof)) {
      return false;
    }

    const committee = epochCtx.getBeaconCommittee(attestationData.slot, attestationData.index);
    if (!committee.includes(aggregatorIndex)) {
      return false;
    }

    const epoch = computeEpochAtSlot(this.config, slot);
    const selectionProofDomain = getDomain(this.config, state, DomainType.SELECTION_PROOF, epoch);
    const selectionProofSigningRoot = computeSigningRoot(
      this.config, this.config.types.Slot, slot, selectionProofDomain);
    const validatorPubKey = state.validators[aggregatorIndex].pubkey;
    if (!verify(
      validatorPubKey.valueOf() as Uint8Array,
      selectionProofSigningRoot,
      selectionProof.valueOf() as Uint8Array,
    )) {
      return false;
    }

    const aggregatorDomain = getDomain(this.config, state, DomainType.AGGREGATE_AND_PROOF, epoch);
    const aggregatorSigningRoot = computeSigningRoot(
      this.config,
      this.config.types.AggregateAndProof,
      aggregateAndProof,
      aggregatorDomain);
    if (!verify(
      validatorPubKey.valueOf() as Uint8Array,
      aggregatorSigningRoot,
      signedAggregationAndProof.signature.valueOf() as Uint8Array,
    )) {
      return false;
    }

    const indexedAttestation = getIndexedAttestation(this.config, state, aggregate);
    return isValidIndexedAttestation(this.config, state, indexedAttestation);
  };

  public isValidIncomingVoluntaryExit = async(voluntaryExit: SignedVoluntaryExit): Promise<boolean> => {
    // skip voluntary exit if it already exists
    if (await this.db.voluntaryExit.has(voluntaryExit.message.validatorIndex)) {
      return false;
    }
    const {state, epochCtx} = await this.chain.getHeadStateContext();
    const startSlot = computeStartSlotAtEpoch(this.config, voluntaryExit.message.epoch);
    if (state.slot < startSlot) {
      processSlots(epochCtx, state, startSlot);
    }
    return isValidVoluntaryExit(this.config, state, voluntaryExit);
  };

  public isValidIncomingProposerSlashing = async(proposerSlashing: ProposerSlashing): Promise<boolean> => {
    // skip proposer slashing if it already exists
    if (await this.db.proposerSlashing.has(proposerSlashing.signedHeader1.message.proposerIndex)) {
      return false;
    }
    const state = await this.chain.getHeadState();
    return isValidProposerSlashing(this.config, state, proposerSlashing);
  };

  public isValidIncomingAttesterSlashing = async (attesterSlashing: AttesterSlashing): Promise<boolean> => {
    const attesterSlashedIndices = arrayIntersection<ValidatorIndex>(
      attesterSlashing.attestation1.attestingIndices.valueOf() as ValidatorIndex[],
      attesterSlashing.attestation2.attestingIndices.valueOf() as ValidatorIndex[],
      sszEqualPredicate(this.config.types.ValidatorIndex)
    );
    if (await this.db.attesterSlashing.hasAll(attesterSlashedIndices)) {
      return false;
    }

    const state = await this.chain.getHeadState();
    return isValidAttesterSlashing(this.config, state, attesterSlashing);
  };
}
