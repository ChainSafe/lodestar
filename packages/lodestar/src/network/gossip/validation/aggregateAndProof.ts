import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db/api";
import {Context, ILogger} from "@chainsafe/lodestar-utils";
import {AggregateAndProof, Attestation, SignedAggregateAndProof, Slot} from "@chainsafe/lodestar-types";
import {ExtendedValidatorResult} from "../constants";
import {toHexString} from "@chainsafe/ssz";
import {ATTESTATION_PROPAGATION_SLOT_RANGE, MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../../constants";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getCurrentSlot,
  isAggregatorFromCommitteeLength,
} from "@chainsafe/lodestar-beacon-state-transition";
import {isAttestingToInValidBlock} from "./attestation";
import {getAttestationPreState} from "../utils";
import {processSlots} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";
import {Signature} from "@chainsafe/bls";
import {isValidIndexedAttestation} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";
import {isValidAggregateAndProofSignature, isValidSelectionProofSignature} from "./utils";

export async function validateGossipAggregateAndProof(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  logger: ILogger,
  signedAggregateAndProof: SignedAggregateAndProof
): Promise<ExtendedValidatorResult> {
  logger.profile("gossipAggregateAndProofValidation");
  const aggregateAndProof = signedAggregateAndProof.message;
  const aggregate = aggregateAndProof.aggregate;
  const root = config.types.AggregateAndProof.hashTreeRoot(aggregateAndProof);
  const attestationRoot = config.types.Attestation.hashTreeRoot(aggregate);
  const logContext = getLogContext(aggregate, aggregateAndProof, root, attestationRoot);
  logger.verbose("Started gossip aggregate and proof validation", logContext);
  if (!isValidAggregateAndProofSlot(config, chain.getGenesisTime(), aggregate.data.slot)) {
    logger.warn("Ignored gossip aggregate and proof", {
      reason: "invalid slot time",
      currentSlot: chain.clock.currentSlot,
      ...logContext,
    });
    //TODO: aggregate and proof pool to wait until proper slot to replay
    return ExtendedValidatorResult.ignore;
  }
  if (await db.seenAttestationCache.hasAggregateAndProof(aggregateAndProof)) {
    logger.warn("Ignored gossip aggregate and proof", {
      reason: "seen aggregator and target index",
      targetEpoch: aggregate.data.target.epoch,
      ...logContext,
    });
    return ExtendedValidatorResult.ignore;
  }
  if (!hasAttestationParticipants(aggregate)) {
    logger.warn("Rejected gossip aggregate and proof", {
      reason: "missing attestation participants",
      ...logContext,
    });
    return ExtendedValidatorResult.reject;
  }

  if (await isAttestingToInValidBlock(db, aggregate)) {
    logger.warn("Rejected gossip aggregate and proof", {
      reason: "attesting to invalid block",
      ...logContext,
    });
    return ExtendedValidatorResult.reject;
  }

  //TODO: check pool of aggregates if already seen (not a dos vector check)

  const result = await validateAggregateAttestation(config, chain, db, logger, logContext, signedAggregateAndProof);

  logger.profile("gossipAggregateAndProofValidation");
  logger.info("Received gossip aggregate and proof passed validation", logContext);
  return result;
}

export function isValidAggregateAndProofSlot(config: IBeaconConfig, genesisTime: number, slot: Slot): boolean {
  const milliSecPerSlot = config.params.SECONDS_PER_SLOT * 1000;
  const currentSlotTime = getCurrentSlot(config, genesisTime) * milliSecPerSlot;
  return (
    (slot + ATTESTATION_PROPAGATION_SLOT_RANGE) * milliSecPerSlot + MAXIMUM_GOSSIP_CLOCK_DISPARITY >= currentSlotTime &&
    currentSlotTime >= slot * milliSecPerSlot - MAXIMUM_GOSSIP_CLOCK_DISPARITY
  );
}

export function hasAttestationParticipants(attestation: Attestation): boolean {
  return Array.from(attestation.aggregationBits).filter((bit) => !!bit).length >= 1;
}

export async function validateAggregateAttestation(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  logger: ILogger,
  logContext: ReturnType<typeof getLogContext>,
  aggregateAndProof: SignedAggregateAndProof
): Promise<ExtendedValidatorResult> {
  const attestation = aggregateAndProof.message.aggregate;
  const attestationPreState = await getAttestationPreState(config, chain, db, attestation.data.target);
  if (!attestationPreState) {
    logger.warn("Ignored gossip aggregate and proof", {reason: "missing attestation prestate", ...logContext});
    return ExtendedValidatorResult.ignore;
  }
  const {state, epochCtx} = attestationPreState;
  //committee changes on epoch, so advance only if different epoch
  const attEpoch = computeEpochAtSlot(config, attestation.data.slot);
  if (attEpoch > computeEpochAtSlot(config, state.slot)) {
    processSlots(epochCtx, state, computeStartSlotAtEpoch(config, attEpoch));
  }
  const committee = epochCtx.getBeaconCommittee(attestation.data.slot, attestation.data.index);
  if (!committee.includes(aggregateAndProof.message.aggregatorIndex)) {
    logger.warn("Rejected gossip aggregate and proof", {reason: "aggregator not in committee", ...logContext});
    return ExtendedValidatorResult.reject;
  }
  if (!isAggregatorFromCommitteeLength(config, committee.length, aggregateAndProof.message.selectionProof)) {
    logger.warn("Rejected gossip aggregate and proof", {reason: "not valid aggregator", ...logContext});
    return ExtendedValidatorResult.reject;
  }
  const aggregator = epochCtx.index2pubkey[aggregateAndProof.message.aggregatorIndex];
  if (
    !isValidSelectionProofSignature(
      config,
      state,
      attestation.data.slot,
      aggregator,
      Signature.fromCompressedBytes(aggregateAndProof.message.selectionProof.valueOf() as Uint8Array)
    )
  ) {
    logger.warn("Rejected gossip aggregate and proof", {reason: "invalid selection proof signature", ...logContext});
    return ExtendedValidatorResult.reject;
  }

  if (
    !isValidAggregateAndProofSignature(
      config,
      state,
      computeEpochAtSlot(config, attestation.data.slot),
      aggregator,
      aggregateAndProof
    )
  ) {
    logger.warn("Rejected gossip aggregate and proof", {reason: "invalid signature", ...logContext});
    return ExtendedValidatorResult.reject;
  }

  //TODO: once we have pool, check if aggregate block is seen and has target as ancestor

  if (!isValidIndexedAttestation(epochCtx, state, epochCtx.getIndexedAttestation(attestation))) {
    logger.warn("Rejected gossip aggregate and proof", {reason: "invalid indexed attestation", ...logContext});
    return ExtendedValidatorResult.reject;
  }

  return ExtendedValidatorResult.accept;
}

//& object so we can spread it
function getLogContext(
  aggregate: Attestation,
  aggregateAndProof: AggregateAndProof,
  root: Uint8Array,
  attestationRoot: Uint8Array
): Context & object {
  return {
    attestationSlot: aggregate.data.slot,
    aggregatorIndex: aggregateAndProof.aggregatorIndex,
    root: toHexString(root),
    attestationRoot: toHexString(attestationRoot),
  };
}
