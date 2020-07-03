import {IGossipMessageValidator} from "./interface";
import {
  Attestation,
  AttesterSlashing,
  ProposerSlashing,
  SignedBeaconBlock,
  SignedVoluntaryExit,
  SignedAggregateAndProof,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../db";
import {
  getCurrentSlot,
  getIndexedAttestation,
  isValidAttesterSlashing,
  isValidIndexedAttestation,
  isValidProposerSlashing,
  isValidVoluntaryExit,
  verifyBlockSignature,
  computeStartSlotAtEpoch,
  processSlots,
  getAttestingIndices,
  isAggregator,
  getDomain,
  computeEpochAtSlot,
  computeSigningRoot,
  computeSubnetForAttestation, getBeaconProposerIndex, getBeaconCommittee
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_PROPAGATION_SLOT_RANGE, DomainType, MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../constants";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconChain} from "../../chain";
import {verify} from "@chainsafe/bls";
import {arrayIntersection, sszEqualPredicate} from "../../util/objects";

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
    const stateContext = await this.db.stateCache.get(parentBlock.message.stateRoot);
    const state = stateContext.state;
    if (state.slot < slot) {
      processSlots(this.config, state, slot);
    }
    // block is not in the future
    const milliSecPerSlot = this.config.params.SECONDS_PER_SLOT * 1000;
    if (signedBlock.message.slot * milliSecPerSlot >
      getCurrentSlot(this.config, state.genesisTime) * milliSecPerSlot + MAXIMUM_GOSSIP_CLOCK_DISPARITY) {
      return false;
    }

    const existingBlock = await this.chain.getBlockAtSlot(signedBlock.message.slot);
    if (existingBlock && existingBlock.message.proposerIndex === signedBlock.message.proposerIndex) {
      // same proposer submitted twice
      return false;
    }

    const root = this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
    // skip block if its a known bad block
    if (await this.db.badBlock.has(root)) {
      this.logger.warn(`Received bad block, block root : ${root} `);
      return false;
    }

    if (!verifyBlockSignature(this.config, state, signedBlock)) {
      return false;
    }
    let supposedProposerIndex;
    if(stateContext.epochCtx) {
      supposedProposerIndex = stateContext.epochCtx.getBeaconProposer(signedBlock.message.slot);
    } else {
      supposedProposerIndex = getBeaconProposerIndex(this.config, state);
    }
    return supposedProposerIndex === signedBlock.message.proposerIndex;
  };

  public isValidIncomingCommitteeAttestation = async (attestation: Attestation, subnet: number): Promise<boolean> => {
    const attestationData = attestation.data;
    const slot = attestationData.slot;
    const {state} = await this.chain.getHeadStateContext();
    const currentSlot = getCurrentSlot(this.config, state.genesisTime);
    if (!(slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= currentSlot && currentSlot >= slot)) {
      return false;
    }
    if (state.slot < slot) {
      processSlots(this.config, state, slot);
    }
    if (subnet !== computeSubnetForAttestation(this.config, state, attestation)) {
      return false;
    }
    // Make sure this is unaggregated attestation
    if (getAttestingIndices(this.config, state, attestationData, attestation.aggregationBits).length !== 1) {
      return false;
    }
    const existingAttestations = await this.db.attestation.geAttestationsByTargetEpoch(
      attestationData.target.epoch
    );
    // each attestation has only 1 validator index
    const existingValidatorIndexes = existingAttestations.map(
      item => getAttestingIndices(this.config, state, item.data, item.aggregationBits)[0]);
    // attestation is unaggregated attestation as validated above
    const validatorIndex = getAttestingIndices(this.config, state, attestationData, attestation.aggregationBits)[0];
    if (existingValidatorIndexes.includes(validatorIndex)) {
      return false;
    }
    const blockRoot = attestationData.beaconBlockRoot.valueOf() as Uint8Array;
    if (!this.chain.forkChoice.hasBlock(blockRoot) || await this.db.badBlock.has(blockRoot)) {
      return false;
    }
    return isValidIndexedAttestation(this.config, state, getIndexedAttestation(this.config, state, attestation));
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
      processSlots(this.config, state, slot);
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

    let committee;
    if(epochCtx) {
      committee = epochCtx.getBeaconCommittee(attestationData.slot, attestationData.index);
    } else {
      committee = getBeaconCommittee(this.config, state, attestationData.slot, attestationData.index);
    }
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
    const {state} = await this.chain.getHeadStateContext();
    const startSlot = computeStartSlotAtEpoch(this.config, voluntaryExit.message.epoch);
    if (state.slot < startSlot) {
      processSlots(this.config, state, startSlot);
    }
    return isValidVoluntaryExit(this.config, state, voluntaryExit);
  };

  public isValidIncomingProposerSlashing = async(proposerSlashing: ProposerSlashing): Promise<boolean> => {
    // skip proposer slashing if it already exists
    if (await this.db.proposerSlashing.has(proposerSlashing.signedHeader1.message.proposerIndex)) {
      return false;
    }
    const {state} = await this.chain.getHeadStateContext();
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

    const {state} = await this.chain.getHeadStateContext();
    return isValidAttesterSlashing(this.config, state, attesterSlashing);
  };
}
