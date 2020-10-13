import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IAttestationJob, IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db/api";
import {Context, ILogger} from "@chainsafe/lodestar-utils";
import {AggregateAndProof, Attestation, SignedAggregateAndProof} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {computeEpochAtSlot, isAggregatorFromCommitteeLength} from "@chainsafe/lodestar-beacon-state-transition";
import {isAttestingToInValidBlock} from "./attestation";
import {Signature} from "@chainsafe/bls";
import {isValidIndexedAttestation} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";
import {isValidAggregateAndProofSignature, isValidSelectionProofSignature} from "./utils";
import {hasValidAttestationSlot} from "./utils/hasValidAttestationSlot";
import {AttestationError, AttestationErrorCode} from "../../../chain/errors";

export async function validateGossipAggregateAndProof(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  logger: ILogger,
  signedAggregateAndProof: SignedAggregateAndProof,
  attestationJob: IAttestationJob
): Promise<void> {
  logger.profile("gossipAggregateAndProofValidation");
  const aggregateAndProof = signedAggregateAndProof.message;
  const aggregate = aggregateAndProof.aggregate;
  const root = config.types.AggregateAndProof.hashTreeRoot(aggregateAndProof);
  const attestationRoot = config.types.Attestation.hashTreeRoot(aggregate);
  const logContext = getLogContext(aggregate, aggregateAndProof, root, attestationRoot);
  logger.verbose("Started gossip aggregate and proof validation", logContext);
  if (!hasValidAttestationSlot(config, chain.clock.currentSlot, aggregate.data.slot)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_SLOT_OUT_OF_RANGE,
      // currentSlot: chain.clock.currentSlot,
      ...logContext,
      job: attestationJob,
    });
    // TODO: aggregate and proof pool to wait until proper slot to replay
  }
  if (await db.seenAttestationCache.hasAggregateAndProof(aggregateAndProof)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_AGGREGATE_ALREADY_KNOWN,
      // targetEpoch: aggregate.data.target.epoch,
      ...logContext,
      root: attestationRoot,
      job: attestationJob,
    });
  }
  if (!hasAttestationParticipants(aggregate)) {
    logger.warn("Rejected gossip aggregate and proof", {
      reason: "missing attestation participants",
      ...logContext,
    });
    throw new AttestationError({
      code: AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS,
      // targetEpoch: aggregate.data.target.epoch,
      ...logContext,
      job: attestationJob,
    });
  }

  if (await isAttestingToInValidBlock(db, aggregate)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_KNOWN_BAD_BLOCK,
      // targetEpoch: aggregate.data.target.epoch,
      ...logContext,
      job: attestationJob,
    });
  }

  // TODO: check pool of aggregates if already seen (not a dos vector check)

  await validateAggregateAttestation(config, chain, db, logger, logContext, signedAggregateAndProof, attestationJob);

  logger.profile("gossipAggregateAndProofValidation");
  logger.info("Received gossip aggregate and proof passed validation", logContext);
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
  aggregateAndProof: SignedAggregateAndProof,
  attestationJob: IAttestationJob
): Promise<void> {
  const attestation = aggregateAndProof.message.aggregate;
  let attestationPreState;
  try {
    // the target state, advanced to the attestation slot
    attestationPreState = await chain.regen.getBlockSlotState(attestation.data.target.root, attestation.data.slot);
  } catch (e) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_MISSING_ATTESTATION_PRESTATE,
      // targetEpoch: aggregate.data.target.epoch,
      ...logContext,
      job: attestationJob,
    });
  }

  const {state, epochCtx} = attestationPreState;
  try {
    const committee = epochCtx.getBeaconCommittee(attestation.data.slot, attestation.data.index);
    if (!committee.includes(aggregateAndProof.message.aggregatorIndex)) {
      throw new AttestationError({
        code: AttestationErrorCode.ERR_AGGREGATOR_NOT_IN_COMMITTEE,
        // targetEpoch: aggregate.data.target.epoch,
        ...logContext,
        aggregatorIndex: aggregateAndProof.message.aggregatorIndex,
        job: attestationJob,
      });
    }
    if (!isAggregatorFromCommitteeLength(config, committee.length, aggregateAndProof.message.selectionProof)) {
      logger.warn("Rejected gossip aggregate and proof", {reason: "not valid aggregator", ...logContext});
      throw new AttestationError({
        code: AttestationErrorCode.ERR_INVALID_AGGREGATOR,
        // targetEpoch: aggregate.data.target.epoch,
        ...logContext,
        job: attestationJob,
      });
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
      throw new AttestationError({
        code: AttestationErrorCode.ERR_INVALID_SELECTION_PROOF,
        // targetEpoch: aggregate.data.target.epoch,
        ...logContext,
        aggregatorIndex: aggregateAndProof.message.aggregatorIndex,
        job: attestationJob,
      });
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
      throw new AttestationError({
        code: AttestationErrorCode.ERR_INVALID_SIGNATURE,
        // targetEpoch: aggregate.data.target.epoch,
        ...logContext,
        job: attestationJob,
      });
    }

    // TODO: once we have pool, check if aggregate block is seen and has target as ancestor

    if (!isValidIndexedAttestation(epochCtx, state, epochCtx.getIndexedAttestation(attestation))) {
      logger.warn("Rejected gossip aggregate and proof", {reason: "invalid indexed attestation", ...logContext});
      throw new AttestationError({
        code: AttestationErrorCode.ERR_INVALID_INDEXED_ATTESTATION,
        // targetEpoch: aggregate.data.target.epoch,
        ...logContext,
        job: attestationJob,
      });
    }
  } catch (e) {
    // if any errors are thrown in the process of checking for REJECTs, return a REJECT
    logger.warn("Rejected gossip aggregate and proof", {reason: e.message, ...logContext});
    // TODO: make error type for this
  }
}

// & object so we can spread it
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
