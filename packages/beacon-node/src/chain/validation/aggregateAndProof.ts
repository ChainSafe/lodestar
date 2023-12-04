import {toHexString} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {phase0, RootHex, ssz, ValidatorIndex} from "@lodestar/types";
import {
  computeEpochAtSlot,
  isAggregatorFromCommitteeLength,
  createAggregateSignatureSetFromComponents,
} from "@lodestar/state-transition";
import {IBeaconChain} from "..";
import {AttestationError, AttestationErrorCode, GossipAction} from "../errors/index.js";
import {RegenCaller} from "../regen/index.js";
import {getAttDataBase64FromSignedAggregateAndProofSerialized} from "../../util/sszBytes.js";
import {getSelectionProofSignatureSet, getAggregateAndProofSignatureSet} from "./signatureSets/index.js";
import {
  getAttestationDataSigningRoot,
  getCommitteeIndices,
  getShufflingForAttestationVerification,
  verifyHeadBlockAndTargetRoot,
  verifyPropagationSlotRange,
} from "./attestation.js";

export type AggregateAndProofValidationResult = {
  indexedAttestation: phase0.IndexedAttestation;
  committeeIndices: ValidatorIndex[];
  attDataRootHex: RootHex;
};

export async function validateApiAggregateAndProof(
  fork: ForkName,
  chain: IBeaconChain,
  signedAggregateAndProof: phase0.SignedAggregateAndProof
): Promise<AggregateAndProofValidationResult> {
  const skipValidationKnownAttesters = true;
  const prioritizeBls = true;
  return validateAggregateAndProof(fork, chain, signedAggregateAndProof, null, {
    skipValidationKnownAttesters,
    prioritizeBls,
  });
}

export async function validateGossipAggregateAndProof(
  fork: ForkName,
  chain: IBeaconChain,
  signedAggregateAndProof: phase0.SignedAggregateAndProof,
  serializedData: Uint8Array
): Promise<AggregateAndProofValidationResult> {
  return validateAggregateAndProof(fork, chain, signedAggregateAndProof, serializedData);
}

async function validateAggregateAndProof(
  fork: ForkName,
  chain: IBeaconChain,
  signedAggregateAndProof: phase0.SignedAggregateAndProof,
  serializedData: Uint8Array | null = null,
  opts: {skipValidationKnownAttesters: boolean; prioritizeBls: boolean} = {
    skipValidationKnownAttesters: false,
    prioritizeBls: false,
  }
): Promise<AggregateAndProofValidationResult> {
  const {skipValidationKnownAttesters, prioritizeBls} = opts;
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
  const attSlot = attData.slot;

  const attDataBase64 = serializedData ? getAttDataBase64FromSignedAggregateAndProofSerialized(serializedData) : null;
  const cachedAttData = attDataBase64 ? chain.seenAttestationDatas.get(attSlot, attDataBase64) : null;

  const attIndex = attData.index;
  const attEpoch = computeEpochAtSlot(attSlot);
  const attTarget = attData.target;
  const targetEpoch = attTarget.epoch;

  chain.metrics?.gossipAttestation.attestationSlotToClockSlot.observe(
    {caller: RegenCaller.validateGossipAggregateAndProof},
    chain.clock.currentSlot - attSlot
  );

  if (!cachedAttData) {
    // [REJECT] The attestation's epoch matches its target -- i.e. attestation.data.target.epoch == compute_epoch_at_slot(attestation.data.slot)
    if (targetEpoch !== attEpoch) {
      throw new AttestationError(GossipAction.REJECT, {code: AttestationErrorCode.BAD_TARGET_EPOCH});
    }

    // [IGNORE] aggregate.data.slot is within the last ATTESTATION_PROPAGATION_SLOT_RANGE slots (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
    // -- i.e. aggregate.data.slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= current_slot >= aggregate.data.slot
    // (a client MAY queue future aggregates for processing at the appropriate slot).
    verifyPropagationSlotRange(fork, chain, attSlot);
  }

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
  const attDataRootHex = cachedAttData
    ? cachedAttData.attDataRootHex
    : toHexString(ssz.phase0.AttestationData.hashTreeRoot(attData));
  if (
    !skipValidationKnownAttesters &&
    chain.seenAggregatedAttestations.isKnown(targetEpoch, attDataRootHex, aggregationBits)
  ) {
    throw new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.ATTESTERS_ALREADY_KNOWN,
      targetEpoch,
      aggregateRoot: attDataRootHex,
    });
  }

  // [IGNORE] The block being voted for (attestation.data.beacon_block_root) has been seen (via both gossip
  // and non-gossip sources) (a client MAY queue attestations for processing once block is retrieved).
  // Lighthouse doesn't check maxSkipSlots option here but Lodestar wants to be more strict
  // to be more DOS protection
  const attHeadBlock = verifyHeadBlockAndTargetRoot(
    chain,
    attData.beaconBlockRoot,
    attTarget.root,
    attSlot,
    attEpoch,
    RegenCaller.validateGossipAggregateAndProof,
    chain.opts.maxSkipSlots
  );

  // [IGNORE] The current finalized_checkpoint is an ancestor of the block defined by aggregate.data.beacon_block_root
  // -- i.e. get_ancestor(store, aggregate.data.beacon_block_root, compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)) == store.finalized_checkpoint.root
  // > Altready check in `chain.forkChoice.hasBlock(attestation.data.beaconBlockRoot)`

  const shuffling = await getShufflingForAttestationVerification(
    chain,
    attEpoch,
    attHeadBlock,
    RegenCaller.validateGossipAttestation
  );

  const committeeIndices: number[] = cachedAttData
    ? cachedAttData.committeeIndices
    : getCommitteeIndices(shuffling, attSlot, attIndex);

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
  const aggregator = chain.index2pubkey[aggregateAndProof.aggregatorIndex];
  const signingRoot = cachedAttData ? cachedAttData.signingRoot : getAttestationDataSigningRoot(chain.config, attData);
  const indexedAttestationSignatureSet = createAggregateSignatureSetFromComponents(
    indexedAttestation.attestingIndices.map((i) => chain.index2pubkey[i]),
    signingRoot,
    indexedAttestation.signature
  );
  const signatureSets = [
    getSelectionProofSignatureSet(chain.config, attSlot, aggregator, signedAggregateAndProof),
    getAggregateAndProofSignatureSet(chain.config, attEpoch, aggregator, signedAggregateAndProof),
    indexedAttestationSignatureSet,
  ];
  // no need to write to SeenAttestationDatas

  if (!(await chain.bls.verifySignatureSets(signatureSets, {batchable: true, priority: prioritizeBls}))) {
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
    attDataRootHex,
    {aggregationBits, trueBitCount: attestingIndices.length},
    false
  );

  return {indexedAttestation, committeeIndices, attDataRootHex};
}
