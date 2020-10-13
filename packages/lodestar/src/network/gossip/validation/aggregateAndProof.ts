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
      currentSlot: chain.clock.currentSlot,
      ...logContext,
      job: attestationJob,
    });
    // TODO: aggregate and proof pool to wait until proper slot to replay
  }
  if (await db.seenAttestationCache.hasAggregateAndProof(aggregateAndProof)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_AGGREGATE_ALREADY_KNOWN,
      ...logContext,
      root: attestationRoot,
      job: attestationJob,
    });
  }
  if (!hasAttestationParticipants(aggregate)) {
    // missing attestation participants
    throw new AttestationError({
      code: AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS,
      ...logContext,
      job: attestationJob,
    });
  }
  if (await isAttestingToInValidBlock(db, aggregate)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_KNOWN_BAD_BLOCK,
      ...logContext,
      job: attestationJob,
    });
  }

  // TODO: check pool of aggregates if already seen (not a dos vector check)

  await validateAggregateAttestation(config, chain, logContext, signedAggregateAndProof, attestationJob);

  logger.profile("gossipAggregateAndProofValidation");
  logger.info("Received gossip aggregate and proof passed validation", logContext);
}

export function hasAttestationParticipants(attestation: Attestation): boolean {
  return Array.from(attestation.aggregationBits).filter((bit) => !!bit).length >= 1;
}

export async function validateAggregateAttestation(
  config: IBeaconConfig,
  chain: IBeaconChain,
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
      ...logContext,
      job: attestationJob,
    });
  }

  const {state, epochCtx} = attestationPreState;
  let committee;
  try {
    committee = epochCtx.getBeaconCommittee(attestation.data.slot, attestation.data.index);
  } catch (error) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_AGGREGATOR_NOT_IN_COMMITTEE,
      ...logContext,
      aggregatorIndex: aggregateAndProof.message.aggregatorIndex,
      job: attestationJob,
    });
  }
  if (!committee.includes(aggregateAndProof.message.aggregatorIndex)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_AGGREGATOR_NOT_IN_COMMITTEE,
      ...logContext,
      aggregatorIndex: aggregateAndProof.message.aggregatorIndex,
      job: attestationJob,
    });
  }
  if (!isAggregatorFromCommitteeLength(config, committee.length, aggregateAndProof.message.selectionProof)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_INVALID_AGGREGATOR,
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
    throw new AttestationError({
      code: AttestationErrorCode.ERR_INVALID_SIGNATURE,
      ...logContext,
      job: attestationJob,
    });
  }

  // TODO: once we have pool, check if aggregate block is seen and has target as ancestor

  if (!isValidIndexedAttestation(epochCtx, state, epochCtx.getIndexedAttestation(attestation))) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_INVALID_INDEXED_ATTESTATION,
      ...logContext,
      job: attestationJob,
    });
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
    targetEpoch: aggregate.data.target.epoch,
  };
}
