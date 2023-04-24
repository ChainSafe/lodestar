import {phase0, Epoch, Root, Slot, RootHex, ssz} from "@lodestar/types";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ATTESTATION_SUBNET_COUNT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {toHexString} from "@chainsafe/ssz";
import {
  computeEpochAtSlot,
  CachedBeaconStateAllForks,
  ISignatureSet,
  getAttestationDataSigningRoot,
  createSingleSignatureSetFromComponents,
} from "@lodestar/state-transition";
import {IBeaconChain} from "..";
import {AttestationError, AttestationErrorCode, GossipAction} from "../errors/index.js";
import {MAXIMUM_GOSSIP_CLOCK_DISPARITY_SEC} from "../../constants/index.js";
import {RegenCaller} from "../regen/index.js";
import {
  AttDataBase64,
  getAggregationBitsFromAttestationSerialized,
  getAttDataBase64FromAttestationSerialized,
  getSignatureFromAttestationSerialized,
} from "../../util/sszBytes.js";
import {AttestationDataCacheEntry} from "../seenCache/seenAttestationData.js";
import {sszDeserializeAttestation} from "../../network/gossip/topic.js";

export type AttestationValidationResult = {
  attestation: phase0.Attestation;
  indexedAttestation: phase0.IndexedAttestation;
  subnet: number;
  attDataRootHex: RootHex;
};

export type AttestationOrBytes =
  // for api
  | {attestation: phase0.Attestation; serializedData: null}
  // for gossip
  | {
      attestation: null;
      serializedData: Uint8Array;
      // available in NetworkProcessor since we check for unknown block root attestations
      attSlot: Slot;
    };

/**
 * Only deserialize the attestation if needed, use the cached AttestationData instead
 * This is to avoid deserializing similar attestation multiple times which could help the gc
 */
export async function validateGossipAttestation(
  chain: IBeaconChain,
  attestationOrBytes: AttestationOrBytes,
  /** Optional, to allow verifying attestations through API with unknown subnet */
  subnet: number | null
): Promise<AttestationValidationResult> {
  // Do checks in this order:
  // - do early checks (w/o indexed attestation)
  // - > obtain indexed attestation and committes per slot
  // - do middle checks w/ indexed attestation
  // - > verify signature
  // - do late checks w/ a valid signature

  // verify_early_checks
  // Run the checks that happen before an indexed attestation is constructed.

  let attestationOrCache:
    | {attestation: phase0.Attestation; cache: null}
    | {attestation: null; cache: AttestationDataCacheEntry; serializedData: Uint8Array};
  let attDataBase64: AttDataBase64 | null;
  if (attestationOrBytes.serializedData) {
    // gossip
    attDataBase64 = getAttDataBase64FromAttestationSerialized(attestationOrBytes.serializedData);
    const attSlot = attestationOrBytes.attSlot;
    const cachedAttData = attDataBase64 !== null ? chain.seenAttestationDatas.get(attSlot, attDataBase64) : null;
    if (cachedAttData === null) {
      const attestation = sszDeserializeAttestation(attestationOrBytes.serializedData);
      // only deserialize on the first AttestationData that's not cached
      attestationOrCache = {attestation, cache: null};
    } else {
      attestationOrCache = {attestation: null, cache: cachedAttData, serializedData: attestationOrBytes.serializedData};
    }
  } else {
    // api
    attDataBase64 = null;
    attestationOrCache = {attestation: attestationOrBytes.attestation, cache: null};
  }

  const attData: phase0.AttestationData = attestationOrCache.attestation
    ? attestationOrCache.attestation.data
    : attestationOrCache.cache.attestationData;
  const attSlot = attData.slot;
  const attIndex = attData.index;
  const attEpoch = computeEpochAtSlot(attSlot);
  const attTarget = attData.target;
  const targetEpoch = attTarget.epoch;

  if (!attestationOrCache.cache) {
    // [REJECT] The attestation's epoch matches its target -- i.e. attestation.data.target.epoch == compute_epoch_at_slot(attestation.data.slot)
    if (targetEpoch !== attEpoch) {
      throw new AttestationError(GossipAction.REJECT, {
        code: AttestationErrorCode.BAD_TARGET_EPOCH,
      });
    }

    // [IGNORE] attestation.data.slot is within the last ATTESTATION_PROPAGATION_SLOT_RANGE slots (within a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
    //  -- i.e. attestation.data.slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= current_slot >= attestation.data.slot
    // (a client MAY queue future attestations for processing at the appropriate slot).
    verifyPropagationSlotRange(chain, attestationOrCache.attestation.data.slot);
  }

  // [REJECT] The attestation is unaggregated -- that is, it has exactly one participating validator
  // (len([bit for bit in attestation.aggregation_bits if bit]) == 1, i.e. exactly 1 bit is set).
  // > TODO: Do this check **before** getting the target state but don't recompute zipIndexes
  const aggregationBits = attestationOrCache.attestation
    ? attestationOrCache.attestation.aggregationBits
    : getAggregationBitsFromAttestationSerialized(attestationOrCache.serializedData);
  if (aggregationBits === null) {
    throw new AttestationError(GossipAction.REJECT, {
      code: AttestationErrorCode.INVALID_SERIALIZED_BYTES,
    });
  }

  const bitIndex = aggregationBits.getSingleTrueBit();
  if (bitIndex === null) {
    throw new AttestationError(GossipAction.REJECT, {
      code: AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET,
    });
  }

  let committeeIndices: number[];
  let getSigningRoot: () => Uint8Array;
  let expectedSubnet: number;
  if (attestationOrCache.cache) {
    committeeIndices = attestationOrCache.cache.committeeIndices;
    const signingRoot = attestationOrCache.cache.signingRoot;
    getSigningRoot = () => signingRoot;
    expectedSubnet = attestationOrCache.cache.subnet;
  } else {
    // Attestations must be for a known block. If the block is unknown, we simply drop the
    // attestation and do not delay consideration for later.
    //
    // TODO (LH): Enforce a maximum skip distance for unaggregated attestations.

    // [IGNORE] The block being voted for (attestation.data.beacon_block_root) has been seen (via both gossip
    // and non-gossip sources) (a client MAY queue attestations for processing once block is retrieved).
    const attHeadBlock = verifyHeadBlockAndTargetRoot(
      chain,
      attestationOrCache.attestation.data.beaconBlockRoot,
      attestationOrCache.attestation.data.target.root,
      attSlot,
      attEpoch,
      chain.opts.maxSkipSlots
    );

    // [REJECT] The block being voted for (attestation.data.beacon_block_root) passes validation.
    // > Altready check in `verifyHeadBlockAndTargetRoot()`

    // [IGNORE] The current finalized_checkpoint is an ancestor of the block defined by attestation.data.beacon_block_root
    // -- i.e. get_ancestor(store, attestation.data.beacon_block_root, compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)) == store.finalized_checkpoint.root
    // > Altready check in `verifyHeadBlockAndTargetRoot()`

    // [REJECT] The attestation's target block is an ancestor of the block named in the LMD vote
    //  --i.e. get_ancestor(store, attestation.data.beacon_block_root, compute_start_slot_at_epoch(attestation.data.target.epoch)) == attestation.data.target.root
    // > Altready check in `verifyHeadBlockAndTargetRoot()`

    // Using the target checkpoint state here caused unstable memory issue
    // See https://github.com/ChainSafe/lodestar/issues/4896
    // TODO: https://github.com/ChainSafe/lodestar/issues/4900
    const attHeadState = await chain.regen
      .getState(attHeadBlock.stateRoot, RegenCaller.validateGossipAttestation)
      .catch((e: Error) => {
        throw new AttestationError(GossipAction.IGNORE, {
          code: AttestationErrorCode.MISSING_ATTESTATION_HEAD_STATE,
          error: e as Error,
        });
      });

    // [REJECT] The committee index is within the expected range
    // -- i.e. data.index < get_committee_count_per_slot(state, data.target.epoch)
    committeeIndices = getCommitteeIndices(attHeadState, attSlot, attIndex);
    getSigningRoot = () => getAttestationDataSigningRoot(attHeadState, attData);
    expectedSubnet = attHeadState.epochCtx.computeSubnetForSlot(attSlot, attIndex);
  }

  const validatorIndex = committeeIndices[bitIndex];

  // [REJECT] The number of aggregation bits matches the committee size
  // -- i.e. len(attestation.aggregation_bits) == len(get_beacon_committee(state, data.slot, data.index)).
  // > TODO: Is this necessary? Lighthouse does not do this check.
  if (aggregationBits.bitLen !== committeeIndices.length) {
    throw new AttestationError(GossipAction.REJECT, {
      code: AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS,
    });
  }

  // LH > verify_middle_checks
  // Run the checks that apply to the indexed attestation before the signature is checked.
  //   Check correct subnet
  //   The attestation is the first valid attestation received for the participating validator for the slot, attestation.data.slot.

  // [REJECT] The attestation is for the correct subnet
  // -- i.e. compute_subnet_for_attestation(committees_per_slot, attestation.data.slot, attestation.data.index) == subnet_id,
  // where committees_per_slot = get_committee_count_per_slot(state, attestation.data.target.epoch),
  // which may be pre-computed along with the committee information for the signature check.
  if (subnet !== null && subnet !== expectedSubnet) {
    throw new AttestationError(GossipAction.REJECT, {
      code: AttestationErrorCode.INVALID_SUBNET_ID,
      received: subnet,
      expected: expectedSubnet,
    });
  }

  // [IGNORE] There has been no other valid attestation seen on an attestation subnet that has an
  // identical attestation.data.target.epoch and participating validator index.
  if (chain.seenAttesters.isKnown(targetEpoch, validatorIndex)) {
    throw new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.ATTESTATION_ALREADY_KNOWN,
      targetEpoch,
      validatorIndex,
    });
  }

  // [REJECT] The signature of attestation is valid.
  const attestingIndices = [validatorIndex];
  let signatureSet: ISignatureSet;
  let attDataRootHex: RootHex;
  const signature = attestationOrCache.attestation
    ? attestationOrCache.attestation.signature
    : getSignatureFromAttestationSerialized(attestationOrCache.serializedData);
  if (signature === null) {
    throw new AttestationError(GossipAction.REJECT, {
      code: AttestationErrorCode.INVALID_SERIALIZED_BYTES,
    });
  }

  if (attestationOrCache.cache) {
    // there could be up to 6% of cpu time to compute signing root if we don't clone the signature set
    signatureSet = createSingleSignatureSetFromComponents(
      chain.index2pubkey[validatorIndex],
      attestationOrCache.cache.signingRoot,
      signature
    );
    attDataRootHex = attestationOrCache.cache.attDataRootHex;
  } else {
    signatureSet = createSingleSignatureSetFromComponents(
      chain.index2pubkey[validatorIndex],
      getSigningRoot(),
      signature
    );

    // add cached attestation data before verifying signature
    attDataRootHex = toHexString(ssz.phase0.AttestationData.hashTreeRoot(attData));
    if (attDataBase64) {
      chain.seenAttestationDatas.add(attSlot, attDataBase64, {
        committeeIndices,
        signingRoot: signatureSet.signingRoot,
        subnet: expectedSubnet,
        // precompute this to be used in forkchoice
        // root of AttestationData was already cached during getIndexedAttestationSignatureSet
        attDataRootHex,
        attestationData: attData,
      });
    }
  }

  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true}))) {
    throw new AttestationError(GossipAction.REJECT, {code: AttestationErrorCode.INVALID_SIGNATURE});
  }

  // Now that the attestation has been fully verified, store that we have received a valid attestation from this validator.
  //
  // It's important to double check that the attestation still hasn't been observed, since
  // there can be a race-condition if we receive two attestations at the same time and
  // process them in different threads.
  if (chain.seenAttesters.isKnown(targetEpoch, validatorIndex)) {
    throw new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.ATTESTATION_ALREADY_KNOWN,
      targetEpoch,
      validatorIndex,
    });
  }

  chain.seenAttesters.add(targetEpoch, validatorIndex);

  const indexedAttestation: phase0.IndexedAttestation = {
    attestingIndices,
    data: attData,
    signature,
  };

  const attestation: phase0.Attestation = attestationOrCache.attestation
    ? attestationOrCache.attestation
    : {
        aggregationBits,
        data: attData,
        signature,
      };
  return {attestation, indexedAttestation, subnet: expectedSubnet, attDataRootHex};
}

/**
 * Verify that the `attestation` is within the acceptable gossip propagation range, with reference
 * to the current slot of the `chain`.
 *
 * Accounts for `MAXIMUM_GOSSIP_CLOCK_DISPARITY`.
 * Note: We do not queue future attestations for later processing
 */
export function verifyPropagationSlotRange(chain: IBeaconChain, attestationSlot: Slot): void {
  // slot with future tolerance of MAXIMUM_GOSSIP_CLOCK_DISPARITY_SEC
  const latestPermissibleSlot = chain.clock.slotWithFutureTolerance(MAXIMUM_GOSSIP_CLOCK_DISPARITY_SEC);
  const earliestPermissibleSlot = Math.max(
    // slot with past tolerance of MAXIMUM_GOSSIP_CLOCK_DISPARITY_SEC
    // ATTESTATION_PROPAGATION_SLOT_RANGE = SLOTS_PER_EPOCH
    chain.clock.slotWithPastTolerance(MAXIMUM_GOSSIP_CLOCK_DISPARITY_SEC) - SLOTS_PER_EPOCH,
    0
  );
  if (attestationSlot < earliestPermissibleSlot) {
    throw new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.PAST_SLOT,
      earliestPermissibleSlot,
      attestationSlot,
    });
  }
  if (attestationSlot > latestPermissibleSlot) {
    throw new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.FUTURE_SLOT,
      latestPermissibleSlot,
      attestationSlot,
    });
  }
}

/**
 * Verify:
 * 1. head block is known
 * 2. attestation's target block is an ancestor of the block named in the LMD vote
 */
export function verifyHeadBlockAndTargetRoot(
  chain: IBeaconChain,
  beaconBlockRoot: Root,
  targetRoot: Root,
  attestationSlot: Slot,
  attestationEpoch: Epoch,
  maxSkipSlots?: number
): ProtoBlock {
  const headBlock = verifyHeadBlockIsKnown(chain, beaconBlockRoot);
  // Lighthouse rejects the attestation, however Lodestar only ignores considering it's not against the spec
  // it's more about a DOS protection to us
  // With verifyPropagationSlotRange() and maxSkipSlots = 32, it's unlikely we have to regenerate states in queue
  // to validate beacon_attestation and aggregate_and_proof
  if (maxSkipSlots !== undefined && attestationSlot - headBlock.slot > maxSkipSlots) {
    throw new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.TOO_MANY_SKIPPED_SLOTS,
      attestationSlot,
      headBlockSlot: headBlock.slot,
    });
  }
  verifyAttestationTargetRoot(headBlock, targetRoot, attestationEpoch);
  return headBlock;
}

/**
 * Checks if the `attestation.data.beaconBlockRoot` is known to this chain.
 *
 * The block root may not be known for two reasons:
 *
 * 1. The block has never been verified by our application.
 * 2. The block is prior to the latest finalized block.
 *
 * Case (1) is the exact thing we're trying to detect. However case (2) is a little different, but
 * it's still fine to ignore here because there's no need for us to handle attestations that are
 * already finalized.
 */
function verifyHeadBlockIsKnown(chain: IBeaconChain, beaconBlockRoot: Root): ProtoBlock {
  // TODO (LH): Enforce a maximum skip distance for unaggregated attestations.

  const headBlock = chain.forkChoice.getBlock(beaconBlockRoot);
  if (headBlock === null) {
    throw new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT,
      root: toHexString(beaconBlockRoot as typeof beaconBlockRoot),
    });
  }

  return headBlock;
}

/**
 * Verifies that the `attestation.data.target.root` is indeed the target root of the block at
 * `attestation.data.beacon_block_root`.
 */
function verifyAttestationTargetRoot(headBlock: ProtoBlock, targetRoot: Root, attestationEpoch: Epoch): void {
  // Check the attestation target root.
  const headBlockEpoch = computeEpochAtSlot(headBlock.slot);

  if (headBlockEpoch > attestationEpoch) {
    // The epoch references an invalid head block from a future epoch.
    //
    // This check is not in the specification, however we guard against it since it opens us up
    // to weird edge cases during verification.
    //
    // Whilst this attestation *technically* could be used to add value to a block, it is
    // invalid in the spirit of the protocol. Here we choose safety over profit.
    //
    // Reference:
    // https://github.com/ethereum/consensus-specs/pull/2001#issuecomment-699246659
    throw new AttestationError(GossipAction.REJECT, {
      code: AttestationErrorCode.INVALID_TARGET_ROOT,
      targetRoot: toHexString(targetRoot),
      expected: null,
    });
  } else {
    const expectedTargetRoot =
      headBlockEpoch === attestationEpoch
        ? // If the block is in the same epoch as the attestation, then use the target root
          // from the block.
          headBlock.targetRoot
        : // If the head block is from a previous epoch then skip slots will cause the head block
          // root to become the target block root.
          //
          // We know the head block is from a previous epoch due to a previous check.
          headBlock.blockRoot;

    // TODO: Do a fast comparision to convert and compare byte by byte
    if (expectedTargetRoot !== toHexString(targetRoot)) {
      // Reject any attestation with an invalid target root.
      throw new AttestationError(GossipAction.REJECT, {
        code: AttestationErrorCode.INVALID_TARGET_ROOT,
        targetRoot: toHexString(targetRoot),
        expected: expectedTargetRoot,
      });
    }
  }
}

export function getCommitteeIndices(
  attestationTargetState: CachedBeaconStateAllForks,
  attestationSlot: Slot,
  attestationIndex: number
): number[] {
  const shuffling = attestationTargetState.epochCtx.getShufflingAtSlotOrNull(attestationSlot);
  if (shuffling === null) {
    // this may come from an out-of-synced node, the spec did not define it so should not REJECT
    // see https://github.com/ChainSafe/lodestar/issues/4396
    throw new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.NO_COMMITTEE_FOR_SLOT_AND_INDEX,
      index: attestationIndex,
      slot: attestationSlot,
    });
  }

  const {committees} = shuffling;
  const slotCommittees = committees[attestationSlot % SLOTS_PER_EPOCH];

  if (attestationIndex >= slotCommittees.length) {
    throw new AttestationError(GossipAction.REJECT, {
      code: AttestationErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE,
      index: attestationIndex,
    });
  }
  return slotCommittees[attestationIndex];
}

/**
 * Compute the correct subnet for a slot/committee index
 */
export function computeSubnetForSlot(state: CachedBeaconStateAllForks, slot: number, committeeIndex: number): number {
  const slotsSinceEpochStart = slot % SLOTS_PER_EPOCH;
  const committeesPerSlot = state.epochCtx.getCommitteeCountPerSlot(computeEpochAtSlot(slot));
  const committeesSinceEpochStart = committeesPerSlot * slotsSinceEpochStart;
  return (committeesSinceEpochStart + committeeIndex) % ATTESTATION_SUBNET_COUNT;
}
