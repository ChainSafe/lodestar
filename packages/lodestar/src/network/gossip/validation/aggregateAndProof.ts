import {Epoch, Number64, SignedAggregateAndProof, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  getCurrentSlot,
  getDomain, isValidIndexedAttestation
} from "@chainsafe/lodestar-beacon-state-transition";
import {ATTESTATION_PROPAGATION_SLOT_RANGE, DomainType, MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../../constants";
import {AggregateAndProofRepository} from "../../../db/api/beacon/repositories";
import {toHexString} from "@chainsafe/ssz";
import {ExtendedValidatorResult} from "../constants";
import {processSlots} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db/api";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Signature} from "@chainsafe/bls";

export async function validateGossipAggregateAndProof(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  logger: ILogger,
  signedAggregationAndProof: SignedAggregateAndProof
): Promise<ExtendedValidatorResult> {
  const aggregateAndProof = signedAggregationAndProof.message;
  const aggregate = aggregateAndProof.aggregate;
  const attestationData = aggregate.data;
  const slot = attestationData.slot;
  const attestationRoot = config.types.Attestation.hashTreeRoot(aggregate);
  const {state, epochCtx} = await chain.getHeadStateContext();
  if (!isValidAttestationTime(config, slot, state.genesisTime)) {
    logger.warn(
      "Ignored gossiped aggregate and proof",
      {reason: "Outside of clock disparity tolerance", attestationRoot: toHexString(attestationRoot)}
    );
    return ExtendedValidatorResult.ignore;
  }
  if (state.slot < slot) {
    processSlots(epochCtx, state, slot);
  }

  if (await db.aggregateAndProof.hasAttestation(aggregate)) {
    logger.verbose("Ignored gossiped aggregate and proof", {reason: "Already have in database"});
    return ExtendedValidatorResult.ignore;
  }

  if (await hasAggregateAndProof(
    db.aggregateAndProof, aggregateAndProof.aggregatorIndex, aggregate.data.target.epoch
  )) {
    logger.debug(
      "Ignored gossiped aggregate and proof",
      {
        reason: "Already have those aggregate for this aggregator",
        aggregatorIndex: aggregateAndProof.aggregatorIndex,
        targetEpoch: aggregateAndProof.aggregate.data.target.epoch,
        attestationRoot: toHexString(attestationRoot)}
    );
    return ExtendedValidatorResult.ignore;
  }

  if (
    epochCtx.getAttestingIndices(
      attestationData,
      aggregate.aggregationBits
    ).length < 1
  ) {
    logger.warn(
      "Rejected gossiped aggregate and proof",
      {reason: "No attesters", attestationRoot: toHexString(attestationRoot)}
    );
    return ExtendedValidatorResult.reject;
  }
  const blockRoot = aggregate.data.beaconBlockRoot.valueOf() as Uint8Array;
  if (!chain.forkChoice.hasBlock(blockRoot) || await db.badBlock.has(blockRoot)) {
    logger.warn(
      "Rejected gossiped aggregate and proof",
      {
        reason: "Attest to invalid block or missing block",
        attestationRoot: toHexString(attestationRoot),
        blockRoot: toHexString(aggregateAndProof.aggregate.data.beaconBlockRoot)
      }
    );
    return ExtendedValidatorResult.reject;
  }

  const selectionProof = aggregateAndProof.selectionProof;
  if (!epochCtx.isAggregator(slot, attestationData.index, selectionProof)) {
    logger.warn(
      "Rejected gossiped aggregate and proof",
      {reason: "Signer not aggregator", attestationRoot: toHexString(attestationRoot)});

    return ExtendedValidatorResult.reject;
  }

  const committee = epochCtx.getBeaconCommittee(attestationData.slot, attestationData.index);
  if (!committee.includes(aggregateAndProof.aggregatorIndex)) {
    logger.debug(
      "Rejected gossiped aggregate and proof",
      {reason: "Aggregator not in committee", attestationRoot: toHexString(attestationRoot)});
    return ExtendedValidatorResult.reject;
  }

  const epoch = computeEpochAtSlot(config, slot);
  const selectionProofDomain = getDomain(config, state, DomainType.SELECTION_PROOF, epoch);
  const selectionProofSigningRoot = computeSigningRoot(
    config, config.types.Slot, slot, selectionProofDomain);
  const validatorPubKey = epochCtx.index2pubkey[aggregateAndProof.aggregatorIndex];
  if (!validatorPubKey.verifyMessage(
    Signature.fromCompressedBytes(selectionProof.valueOf() as Uint8Array),
    selectionProofSigningRoot,
  )) {
    logger.warn(
      "Rejected gossiped aggregate and proof",
      {reason: "Invalid selection proof signature", attestationRoot: toHexString(attestationRoot)}
    );
    return ExtendedValidatorResult.reject;
  }

  const aggregatorDomain = getDomain(config, state, DomainType.AGGREGATE_AND_PROOF, epoch);
  const aggregatorSigningRoot = computeSigningRoot(
    config,
    config.types.AggregateAndProof,
    aggregateAndProof,
    aggregatorDomain);
  if (!epochCtx.index2pubkey[aggregateAndProof.aggregatorIndex].verifyMessage(
    Signature.fromCompressedBytes(signedAggregationAndProof.signature.valueOf() as Uint8Array),
    aggregatorSigningRoot,
  )) {
    logger.warn(
      "Rejected gossiped aggregate and proof",
      {
        reason: "Invalid aggregate and proof signature",
        attestationRoot: toHexString(attestationRoot)
      }
    );
    return ExtendedValidatorResult.reject;
  }

  const indexedAttestation = epochCtx.getIndexedAttestation(aggregate);
  if (!isValidIndexedAttestation(config, state, indexedAttestation)) {
    logger.warn(
      "Ignored gossiped aggregate and proof",
      {reason: "Not a valid indexec attestation", attestationRoot: toHexString(attestationRoot)}
    );
    return ExtendedValidatorResult.reject;
  }
  logger.debug(
    "Received gossip aggregate and proof passed validation",
    {attestationRoot: toHexString(attestationRoot)}
  );
  return ExtendedValidatorResult.accept;
}

export function isValidAttestationTime(config: IBeaconConfig, attestationSlot: Slot, genesisTime: Number64): boolean {
  const currentSlot = getCurrentSlot(config, genesisTime);
  const attestationTime = (genesisTime + attestationSlot * config.params.SECONDS_PER_SLOT) * 1000;
  const upperBound = Date.now() + MAXIMUM_GOSSIP_CLOCK_DISPARITY;
  const lowerBound = (genesisTime
      + (currentSlot - ATTESTATION_PROPAGATION_SLOT_RANGE) * config.params.SECONDS_PER_SLOT) * 1000;
  return lowerBound < attestationTime && attestationTime < upperBound;
}

export async function hasAggregateAndProof(
  repository: AggregateAndProofRepository, aggregatorIndex: number, targetEpoch: Epoch
): Promise<boolean> {
  const existingAttestations = await repository.getByAggregatorAndEpoch(
    aggregatorIndex, targetEpoch) || [];
  return existingAttestations.length > 0;
}
