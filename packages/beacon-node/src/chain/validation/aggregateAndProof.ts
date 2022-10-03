import {toHexString} from "@chainsafe/ssz";
import {phase0, ssz, ValidatorIndex} from "@lodestar/types";
import {
  computeEpochAtSlot,
  isAggregatorFromCommitteeLength,
  getIndexedAttestationSignatureSet,
} from "@lodestar/state-transition";
import {IBeaconChain} from "..";
import {AttestationError, AttestationErrorCode, GossipAction} from "../errors/index.js";
import {RegenCaller} from "../regen/index.js";
import {getSelectionProofSignatureSet, getAggregateAndProofSignatureSet} from "./signatureSets/index.js";
import {getCommitteeIndices, verifyHeadBlockAndTargetRoot, verifyPropagationSlotRange} from "./attestation.js";

export async function validateGossipAggregateAndProof(
  chain: IBeaconChain,
  signedAggregateAndProof: phase0.SignedAggregateAndProof,
  skipValidationKnownAttesters = false
): Promise<{indexedAttestation: phase0.IndexedAttestation; committeeIndices: ValidatorIndex[]}> {
  // Do checks in this order:
  // - do early checks (w/o indexed attestation)
  // - > obtain indexed attestation and committes per slot
  // - do middle checks w/ indexed attestation
  // - > verify signature
  // - do late checks w/ a valid signature

  const aggregateAndProof = signedAggregateAndProof.message;
  const aggregate = aggregateAndProof.aggregate;
  const {aggregationBits} = aggregate;
  const attData = aggregate.data;
  const attDataRoot = toHexString(ssz.phase0.AttestationData.hashTreeRoot(attData));
  const attSlot = attData.slot;
  const attIndex = attData.index;
  const attEpoch = computeEpochAtSlot(attSlot);
  const attTarget = attData.target;
  const targetEpoch = attTarget.epoch;

  // [REJECT] The attestation's epoch matches its target -- i.e. attestation.data.target.epoch == compute_epoch_at_slot(attestation.data.slot)
  if (targetEpoch !== attEpoch) {
    throw new AttestationError(GossipAction.REJECT, {code: AttestationErrorCode.BAD_TARGET_EPOCH});
  }

  // [IGNORE] aggregate.data.slot is within the last ATTESTATION_PROPAGATION_SLOT_RANGE slots (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  // -- i.e. aggregate.data.slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= current_slot >= aggregate.data.slot
  // (a client MAY queue future aggregates for processing at the appropriate slot).
  verifyPropagationSlotRange(chain, attSlot);

  // [IGNORE] The aggregate is the first valid aggregate received for the aggregator with
  // index aggregate_and_proof.aggregator_index for the epoch aggregate.data.target.epoch.
  const aggregatorIndex = aggregateAndProof.aggregatorIndex;
  if (chain.seenAggregators.isKnown(targetEpoch, aggregatorIndex)) {
    throw new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.AGGREGATOR_ALREADY_KNOWN,
      targetEpoch,
      aggregatorIndex,
    });
  }

  // _[IGNORE]_ A valid aggregate attestation defined by `hash_tree_root(aggregate.data)` whose `aggregation_bits`
  // is a non-strict superset has _not_ already been seen.
  if (
    !skipValidationKnownAttesters &&
    chain.seenAggregatedAttestations.isKnown(targetEpoch, attDataRoot, aggregationBits)
  ) {
    throw new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.ATTESTERS_ALREADY_KNOWN,
      targetEpoch,
      aggregateRoot: attDataRoot,
    });
  }

  // [IGNORE] The block being voted for (attestation.data.beacon_block_root) has been seen (via both gossip
  // and non-gossip sources) (a client MAY queue attestations for processing once block is retrieved).
  const attHeadBlock = verifyHeadBlockAndTargetRoot(chain, attData.beaconBlockRoot, attTarget.root, attEpoch);

  // [IGNORE] The current finalized_checkpoint is an ancestor of the block defined by aggregate.data.beacon_block_root
  // -- i.e. get_ancestor(store, aggregate.data.beacon_block_root, compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)) == store.finalized_checkpoint.root
  // > Altready check in `chain.forkChoice.hasBlock(attestation.data.beaconBlockRoot)`

  const attHeadState = await chain.regen
    .getState(attHeadBlock.stateRoot, RegenCaller.validateGossipAggregateAndProof)
    .catch((e: Error) => {
      throw new AttestationError(GossipAction.REJECT, {
        code: AttestationErrorCode.MISSING_ATTESTATION_HEAD_STATE,
        error: e as Error,
      });
    });

  const committeeIndices: number[] = getCommitteeIndices(attHeadState, attSlot, attIndex);

  const attestingIndices = aggregate.aggregationBits.intersectValues(committeeIndices);
  const indexedAttestation: phase0.IndexedAttestation = {
    attestingIndices,
    data: attData,
    signature: aggregate.signature,
  };

  // TODO: Check this before regen
  // [REJECT] The attestation has participants -- that is,
  // len(get_attesting_indices(state, aggregate.data, aggregate.aggregation_bits)) >= 1.
  if (attestingIndices.length < 1) {
    // missing attestation participants
    throw new AttestationError(GossipAction.REJECT, {code: AttestationErrorCode.EMPTY_AGGREGATION_BITFIELD});
  }

  // [REJECT] aggregate_and_proof.selection_proof selects the validator as an aggregator for the slot
  // -- i.e. is_aggregator(state, aggregate.data.slot, aggregate.data.index, aggregate_and_proof.selection_proof) returns True.
  if (!isAggregatorFromCommitteeLength(committeeIndices.length, aggregateAndProof.selectionProof)) {
    throw new AttestationError(GossipAction.REJECT, {code: AttestationErrorCode.INVALID_AGGREGATOR});
  }

  // [REJECT] The aggregator's validator index is within the committee
  // -- i.e. aggregate_and_proof.aggregator_index in get_beacon_committee(state, aggregate.data.slot, aggregate.data.index).
  if (!committeeIndices.includes(aggregateAndProof.aggregatorIndex)) {
    throw new AttestationError(GossipAction.REJECT, {code: AttestationErrorCode.AGGREGATOR_NOT_IN_COMMITTEE});
  }

  // [REJECT] The aggregate_and_proof.selection_proof is a valid signature of the aggregate.data.slot
  // by the validator with index aggregate_and_proof.aggregator_index.
  // [REJECT] The aggregator signature, signed_aggregate_and_proof.signature, is valid.
  // [REJECT] The signature of aggregate is valid.
  const aggregator = attHeadState.epochCtx.index2pubkey[aggregateAndProof.aggregatorIndex];
  const signatureSets = [
    getSelectionProofSignatureSet(attHeadState, attSlot, aggregator, signedAggregateAndProof),
    getAggregateAndProofSignatureSet(attHeadState, attEpoch, aggregator, signedAggregateAndProof),
    getIndexedAttestationSignatureSet(attHeadState, indexedAttestation),
  ];
  if (!(await chain.bls.verifySignatureSets(signatureSets, {batchable: true}))) {
    throw new AttestationError(GossipAction.REJECT, {code: AttestationErrorCode.INVALID_SIGNATURE});
  }

  // It's important to double check that the attestation still hasn't been observed, since
  // there can be a race-condition if we receive two attestations at the same time and
  // process them in different threads.
  if (chain.seenAggregators.isKnown(targetEpoch, aggregatorIndex)) {
    throw new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.AGGREGATOR_ALREADY_KNOWN,
      targetEpoch,
      aggregatorIndex,
    });
  }

  chain.seenAggregators.add(targetEpoch, aggregatorIndex);
  chain.seenAggregatedAttestations.add(
    targetEpoch,
    attDataRoot,
    {aggregationBits, trueBitCount: attestingIndices.length},
    false
  );

  return {indexedAttestation, committeeIndices};
}
