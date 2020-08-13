import {IGossipMessageValidator} from "./interface";
import {
  Attestation,
  AttesterSlashing,
  ProposerSlashing, SignedAggregateAndProof,
  SignedBeaconBlock, SignedVoluntaryExit,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../db";
import {
  isValidAttesterSlashing,
  isValidProposerSlashing,
  computeEpochAtSlot,
  getDomain, computeSigningRoot, computeStartSlotAtEpoch, isValidVoluntaryExit,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconChain} from "../../chain";
import {arrayIntersection, sszEqualPredicate} from "../../util/objects";
import {ExtendedValidatorResult} from "./constants";
import {hasValidAttestationSlot, validateGossipAttestation, validateGossipBlock} from "./validation";
import {toHexString} from "@chainsafe/ssz";
import {processSlots} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";
import {DomainType} from "../../constants";
import {Signature, verify} from "@chainsafe/bls";
import {
  isValidIndexedAttestation
} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";

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

  public isValidIncomingBlock = async (signedBlock: SignedBeaconBlock): Promise<ExtendedValidatorResult> => {
    try {
      return await validateGossipBlock(this.config, this.chain, this.db, this.logger, signedBlock);
    } catch (e) {
      this.logger.error("Error while validating gossip block", e);
      return ExtendedValidatorResult.ignore;
    }
  };

  public isValidIncomingCommitteeAttestation =
  async (attestation: Attestation, subnet: number): Promise<ExtendedValidatorResult> => {
    try {
      return await validateGossipAttestation(this.config, this.chain, this.db, this.logger, attestation, subnet);
    } catch (e) {
      this.logger.error("Error while validating gossip attestation", e);
      return ExtendedValidatorResult.ignore;
    }
  };

  public isValidIncomingAggregateAndProof =
  async (signedAggregationAndProof: SignedAggregateAndProof): Promise<ExtendedValidatorResult> => {
    const aggregateAndProof = signedAggregationAndProof.message;
    const aggregate = aggregateAndProof.aggregate;
    const attestationData = aggregate.data;
    const slot = attestationData.slot;
    const attestationRoot = this.config.types.Attestation.hashTreeRoot(aggregate);
    const {state, epochCtx} = await this.chain.getHeadStateContext();
    if (hasValidAttestationSlot(this.config, state.genesisTime, aggregate)) {
      this.logger.warn(
        "Ignored gossiped aggregate and proof",
        {reason: "Outside of clock disparity tolerance", attestationRoot: toHexString(attestationRoot)}
      );
      return ExtendedValidatorResult.ignore;
    }
    if (state.slot < slot) {
      processSlots(epochCtx, state, slot);
    }

    if (await this.db.aggregateAndProof.hasAttestation(aggregate)) {
      this.logger.warn("Ignored gossiped aggregate and proof", {reason: "Already have in database"});
      return ExtendedValidatorResult.ignore;
    }

    if (await this.db.seenAttestationCache.hasAggreagateAndProof(aggregateAndProof)) {
      this.logger.warn(
        "Ignored gossiped aggregate and proof",
        {reason: "Already have those attestations", attestationRoot: toHexString(attestationRoot)}
      );
      return ExtendedValidatorResult.ignore;
    }

    if (
      epochCtx.getAttestingIndices(
        attestationData,
        aggregate.aggregationBits
      ).length < 1
    ) {
      this.logger.warn(
        "Rejected gossiped aggregate and proof",
        {reason: "No attesters", attestationRoot: toHexString(attestationRoot)}
      );
      return ExtendedValidatorResult.reject;
    }

    const blockRoot = aggregate.data.beaconBlockRoot.valueOf() as Uint8Array;
    if (!this.chain.forkChoice.hasBlock(blockRoot) || await this.db.badBlock.has(blockRoot)) {
      this.logger.warn(
        "Rejected gossiped aggregate and proof",
        {reason: "Attest to invalid block or missing block", attestationRoot: toHexString(attestationRoot)}
      );
      return ExtendedValidatorResult.reject;
    }

    const selectionProof = aggregateAndProof.selectionProof;
    if (!epochCtx.isAggregator(slot, attestationData.index, selectionProof)) {
      this.logger.warn(
        "Rejected gossiped aggregate and proof",
        {reason: "Signer not aggregator", attestationRoot: toHexString(attestationRoot)});

      return ExtendedValidatorResult.reject;
    }

    const committee = epochCtx.getBeaconCommittee(attestationData.slot, attestationData.index);
    if (!committee.includes(aggregateAndProof.aggregatorIndex)) {
      this.logger.debug(
        "Rejected gossiped aggregate and proof",
        {reason: "Aggregator not in committee", attestationRoot: toHexString(attestationRoot)});
      return ExtendedValidatorResult.reject;
    }

    const epoch = computeEpochAtSlot(this.config, slot);
    const selectionProofDomain = getDomain(this.config, state, DomainType.SELECTION_PROOF, epoch);
    const selectionProofSigningRoot = computeSigningRoot(
      this.config, this.config.types.Slot, slot, selectionProofDomain);
    const validatorPubKey = epochCtx.index2pubkey[aggregateAndProof.aggregatorIndex];
    if (!validatorPubKey.verifyMessage(
      Signature.fromCompressedBytes(selectionProof.valueOf() as Uint8Array),
      selectionProofSigningRoot,
    )) {
      this.logger.warn(
        "Rejected gossiped aggregate and proof",
        {reason: "Invalid selection proof signature", attestationRoot: toHexString(attestationRoot)}
      );
      return ExtendedValidatorResult.reject;
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
      this.logger.warn(
        "Rejected gossiped aggregate and proof",
        {reason: "Invalid aggregate and proof signature"}
      );
      return ExtendedValidatorResult.reject;
    }

    const indexedAttestation = epochCtx.getIndexedAttestation(aggregate);
    if (!isValidIndexedAttestation(epochCtx, state, indexedAttestation)) {
      this.logger.debug("Ignored gossiped aggregate and proof", {reason: "Not a valid attestation"});
      return ExtendedValidatorResult.reject;
    }
    await this.db.seenAttestationCache.addAggregateAndProod(aggregateAndProof);
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingVoluntaryExit = async(voluntaryExit: SignedVoluntaryExit): Promise<ExtendedValidatorResult> => {
    // skip voluntary exit if it already exists
    if (await this.db.voluntaryExit.has(voluntaryExit.message.validatorIndex)) {
      return ExtendedValidatorResult.ignore;
    }
    const {state, epochCtx} = await this.chain.getHeadStateContext();
    const startSlot = computeStartSlotAtEpoch(this.config, voluntaryExit.message.epoch);
    if (state.slot < startSlot) {
      processSlots(epochCtx, state, startSlot);
    }
    if (!isValidVoluntaryExit(this.config, state, voluntaryExit)) {
      return ExtendedValidatorResult.reject;
    }
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingProposerSlashing =
  async(proposerSlashing: ProposerSlashing): Promise<ExtendedValidatorResult> => {
    // skip proposer slashing if it already exists
    if (await this.db.proposerSlashing.has(proposerSlashing.signedHeader1.message.proposerIndex)) {
      return ExtendedValidatorResult.ignore;
    }
    const state = await this.chain.getHeadState();
    if (!isValidProposerSlashing(this.config, state, proposerSlashing)) {
      return ExtendedValidatorResult.reject;
    }
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingAttesterSlashing =
  async (attesterSlashing: AttesterSlashing): Promise<ExtendedValidatorResult> => {
    const attesterSlashedIndices = arrayIntersection<ValidatorIndex>(
      attesterSlashing.attestation1.attestingIndices.valueOf() as ValidatorIndex[],
      attesterSlashing.attestation2.attestingIndices.valueOf() as ValidatorIndex[],
      sszEqualPredicate(this.config.types.ValidatorIndex)
    );
    if (await this.db.attesterSlashing.hasAll(attesterSlashedIndices)) {
      return ExtendedValidatorResult.ignore;
    }

    const state = await this.chain.getHeadState();
    if (!isValidAttesterSlashing(this.config, state, attesterSlashing)) {
      return ExtendedValidatorResult.reject;
    }
    return ExtendedValidatorResult.accept;
  };

}
