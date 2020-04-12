import {IGossipMessageValidator} from "./interface";
import {
  Attestation,
  AttesterSlashing,
  ProposerSlashing,
  SignedBeaconBlock,
  SignedVoluntaryExit,
  SignedAggregateAndProof,
} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../db";
import {getAttestationSubnet} from "./utils";
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
  getBeaconProposerIndex,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_PROPAGATION_SLOT_RANGE, DomainType, MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../constants";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconChain} from "../../chain";
import {verify} from "@chainsafe/bls";
import {OpPool} from "../../opPool";

/* eslint-disable @typescript-eslint/interface-name-prefix */
interface GossipMessageValidatorModules {
  chain: IBeaconChain;
  db: IBeaconDb;
  opPool: OpPool;
  config: IBeaconConfig;
  logger: ILogger;
}

export class GossipMessageValidator implements IGossipMessageValidator {
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly opPool: OpPool;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;

  public constructor({chain, db, opPool, config, logger}: GossipMessageValidatorModules) {
    this.chain = chain;
    this.db = db;
    this.opPool = opPool;
    this.config = config;
    this.logger = logger;
  }

  public isValidIncomingBlock = async (signedBlock: SignedBeaconBlock): Promise<boolean> => {
    const state = await this.db.state.get(this.chain.forkChoice.headStateRoot());
    const slot = signedBlock.message.slot;
    if (state.slot < slot) {
      processSlots(this.config, state, slot);
    }
    // block is not in the future
    const milliSecPerSlot = this.config.params.SECONDS_PER_SLOT * 1000;
    if (signedBlock.message.slot * milliSecPerSlot >
      getCurrentSlot(this.config, state.genesisTime) * milliSecPerSlot + MAXIMUM_GOSSIP_CLOCK_DISPARITY) {
      return false;
    }

    // block is too old
    if (signedBlock.message.slot <= computeStartSlotAtEpoch(this.config, state.finalizedCheckpoint.epoch)) {
      return false;
    }
    
    const existingBLock = await this.db.block.getBlockBySlot(signedBlock.message.slot);
    if (existingBLock && existingBLock.message.proposerIndex === signedBlock.message.proposerIndex) {
      // same proposer submitted twice
      return false;
    }

    const root = this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
    // skip block if its a known bad block
    if (await this.db.block.isBadBlock(root)) {
      this.logger.warn(`Received bad block, block root : ${root} `);
      return false;
    }

    if (!verifyBlockSignature(this.config, state, signedBlock)) {
      return false;
    }

    const supposedProposerIndex = getBeaconProposerIndex(this.config, state);
    if (supposedProposerIndex !== signedBlock.message.proposerIndex) {
      return false;
    }

    return true;
  };

  public isUnaggregatedAttestation = (attestation: Attestation): boolean => {
    const aggregationBits = attestation.aggregationBits;
    let count = 0;
    for (let i = 0; i < aggregationBits.length; i++) {
      if (aggregationBits[i]) {
        count++;
      }
    }
    return count === 1;
  };

  public isValidIncomingCommitteeAttestation = async (attestation: Attestation, subnet: number): Promise<boolean> => {
    if (String(subnet) !== getAttestationSubnet(attestation)) {
      return false;
    }
    // Make sure this is unaggregated attestation
    if (!this.isUnaggregatedAttestation(attestation)) {
      return false;
    }
    const blockRoot = attestation.data.beaconBlockRoot.valueOf() as Uint8Array;
    if (!await this.db.block.has(blockRoot) || await this.db.block.isBadBlock(blockRoot)) {
      return false;
    }
    const state = await this.db.state.get(this.chain.forkChoice.headStateRoot());
    if (state.slot < attestation.data.slot) {
      processSlots(this.config, state, attestation.data.slot);
    }
    const currentSlot = getCurrentSlot(this.config, state.genesisTime);
    if (!(attestation.data.slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= currentSlot &&
        currentSlot >= attestation.data.slot)) {
      return false;
    }
    const existingAttestations = await this.opPool.attestations.geAttestationsBySlot(attestation.data.slot) || [];
    // each attestation has only 1 validator index
    const existingValidatorIndexes = existingAttestations.map(
      item => getAttestingIndices(this.config, state, item.data, item.aggregationBits)[0]);
    // attestation is unaggregated attestation as validated above
    const validatorIndex = getAttestingIndices(this.config, state, attestation.data, attestation.aggregationBits)[0];
    if (existingValidatorIndexes.includes(validatorIndex)) {
      return false;
    }
    return isValidIndexedAttestation(this.config, state, getIndexedAttestation(this.config, state, attestation));
  };

  public isValidIncomingAggregateAndProof = 
  async (signedAggregationAndProof: SignedAggregateAndProof): Promise<boolean> => {
    const aggregateAndProof = signedAggregationAndProof.message;
    const aggregate = aggregateAndProof.aggregate;
    const attestationData = aggregate.data;
    const state = await this.db.state.get(this.chain.forkChoice.headStateRoot());
    const slot = attestationData.slot;
    if (state.slot < slot) {
      processSlots(this.config, state, slot);
    }

    const currentSlot = getCurrentSlot(this.config, state.genesisTime);
    const milliSecPerSlot = this.config.params.SECONDS_PER_SLOT * 1000;
    const currentSlotTime = currentSlot * milliSecPerSlot;
    if (!((slot + ATTESTATION_PROPAGATION_SLOT_RANGE) * milliSecPerSlot + MAXIMUM_GOSSIP_CLOCK_DISPARITY
      >= currentSlotTime && currentSlotTime >= slot * milliSecPerSlot - MAXIMUM_GOSSIP_CLOCK_DISPARITY)) {
      return false;
    }

    if (await this.opPool.aggregateAndProofs.hasAttestation(aggregate)) {
      return false;
    }

    const aggregatorIndex = aggregateAndProof.aggregatorIndex;
    const existingAttestations = await this.opPool.aggregateAndProofs.getByAggregatorAndSlot(
      aggregatorIndex, slot) || [];
    if (existingAttestations.length > 0) {
      return false;
    }

    const blockRoot = aggregate.data.beaconBlockRoot.valueOf() as Uint8Array;
    if (!await this.db.block.has(blockRoot) || await this.db.block.isBadBlock(blockRoot)) {
      return false;
    }

    const selectionProof = aggregateAndProof.selectionProof;
    if (!isAggregator(this.config, state, slot, attestationData.index, selectionProof)) {
      return false;
    }
    
    const attestorIndices = getAttestingIndices(this.config, state, attestationData, aggregate.aggregationBits);
    if (!attestorIndices.includes(aggregatorIndex)) {
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

  public isValidIncomingUnaggregatedAttestation = async (attestation: Attestation): Promise<boolean> => {
    if (!this.isUnaggregatedAttestation(attestation)) {
      return false;
    }
    // skip attestation if it already exists
    const root = this.config.types.Attestation.hashTreeRoot(attestation);
    if (await this.db.attestation.has(root as Buffer)) {
      return false;
    }
    // skip attestation if its too old
    const state = await this.db.state.get(this.chain.forkChoice.headStateRoot());
    return attestation.data.target.epoch >= state.finalizedCheckpoint.epoch;
  };

  public isValidIncomingVoluntaryExit = async(voluntaryExit: SignedVoluntaryExit): Promise<boolean> => {
    // skip voluntary exit if it already exists
    const root = this.config.types.SignedVoluntaryExit.hashTreeRoot(voluntaryExit);
    if (await this.db.voluntaryExit.has(root as Buffer)) {
      return false;
    }
    const state = await this.db.state.get(this.chain.forkChoice.headStateRoot());
    const startSlot = computeStartSlotAtEpoch(this.config, voluntaryExit.message.epoch);
    if (state.slot < startSlot) {
      processSlots(this.config, state, startSlot);
    }
    return isValidVoluntaryExit(this.config, state, voluntaryExit);
  };

  public isValidIncomingProposerSlashing = async(proposerSlashing: ProposerSlashing): Promise<boolean> => {
    // skip proposer slashing if it already exists
    const root = this.config.types.ProposerSlashing.hashTreeRoot(proposerSlashing);
    if (await this.db.proposerSlashing.has(root as Buffer)) {
      return false;
    }
    const state = await this.db.state.get(this.chain.forkChoice.headStateRoot());
    return isValidProposerSlashing(this.config, state, proposerSlashing);
  };

  public isValidIncomingAttesterSlashing = async (attesterSlashing: AttesterSlashing): Promise<boolean> => {
    // skip attester slashing if it already exists
    const root = this.config.types.AttesterSlashing.hashTreeRoot(attesterSlashing);
    if (await this.db.attesterSlashing.has(root as Buffer)) {
      return false;
    }
    const state = await this.db.state.get(this.chain.forkChoice.headStateRoot());
    return isValidAttesterSlashing(this.config, state, attesterSlashing);
  };
}
