import {toHexString} from "@chainsafe/ssz";
import {phase0, Epoch, Root, Slot, RootHex, ssz} from "@lodestar/types";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ATTESTATION_SUBNET_COUNT, SLOTS_PER_EPOCH, ForkName, ForkSeq, DOMAIN_BEACON_ATTESTER} from "@lodestar/params";
import {
  computeEpochAtSlot,
  createSingleSignatureSetFromComponents,
  SingleSignatureSet,
  EpochCacheError,
  EpochCacheErrorCode,
  EpochShuffling,
  computeStartSlotAtEpoch,
  computeSigningRoot,
} from "@lodestar/state-transition";
import {BeaconConfig} from "@lodestar/config";
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
import {Result, wrapError} from "../../util/wrapError.js";
import {IBeaconChain} from "../interface.js";
import {getShufflingDependentRoot} from "../../util/dependentRoot.js";

export type BatchResult = {
  results: Result<AttestationValidationResult>[];
  batchableBls: boolean;
};

export type AttestationValidationResult = {
  attestation: phase0.Attestation;
  indexedAttestation: phase0.IndexedAttestation;
  subnet: number;
  attDataRootHex: RootHex;
};

export type AttestationOrBytes = ApiAttestation | GossipAttestation;

/** attestation from api */
export type ApiAttestation = {attestation: phase0.Attestation; serializedData: null};

/** attestation from gossip */
export type GossipAttestation = {
  attestation: null;
  serializedData: Uint8Array;
  // available in NetworkProcessor since we check for unknown block root attestations
  attSlot: Slot;
  attDataBase64?: string | null;
};

export type Step0Result = AttestationValidationResult & {
  signatureSet: SingleSignatureSet;
  validatorIndex: number;
};

/**
 * Validate a single gossip attestation, do not prioritize bls signature set
 */
export async function validateGossipAttestation(
  fork: ForkName,
  chain: IBeaconChain,
  attestationOrBytes: GossipAttestation,
  /** Optional, to allow verifying attestations through API with unknown subnet */
  subnet: number
): Promise<AttestationValidationResult> {
  const prioritizeBls = false;
  return validateAttestation(fork, chain, attestationOrBytes, subnet, prioritizeBls);
}

/**
 * Verify gossip attestations of the same attestation data. The main advantage is we can batch verify bls signatures
 * through verifySignatureSetsSameMessage bls api to improve performance.
 *   - If there are less than 2 signatures (minSameMessageSignatureSetsToBatch), verify each signature individually with batchable = true
 *   - do not prioritize bls signature set
 */
export async function validateGossipAttestationsSameAttData(
  fork: ForkName,
  chain: IBeaconChain,
  attestationOrBytesArr: AttestationOrBytes[],
  subnet: number,
  // for unit test, consumers do not need to pass this
  step0ValidationFn = validateGossipAttestationNoSignatureCheck
): Promise<BatchResult> {
  if (attestationOrBytesArr.length === 0) {
    return {results: [], batchableBls: false};
  }

  // step0: do all verifications except for signature verification
  // this for await pattern below seems to be bad but it's not
  // for seen AttestationData, it's the same to await Promise.all() pattern
  // for unseen AttestationData, the 1st call will be cached and the rest will be fast
  const step0ResultOrErrors: Result<Step0Result>[] = [];
  for (const attestationOrBytes of attestationOrBytesArr) {
    const resultOrError = await wrapError(step0ValidationFn(fork, chain, attestationOrBytes, subnet));
    step0ResultOrErrors.push(resultOrError);
  }

  // step1: verify signatures of all valid attestations
  // map new index to index in resultOrErrors
  const newIndexToOldIndex = new Map<number, number>();
  const signatureSets: SingleSignatureSet[] = [];
  let newIndex = 0;
  const step0Results: Step0Result[] = [];
  for (const [i, resultOrError] of step0ResultOrErrors.entries()) {
    if (resultOrError.err) {
      continue;
    }
    step0Results.push(resultOrError.result);
    newIndexToOldIndex.set(newIndex, i);
    signatureSets.push(resultOrError.result.signatureSet);
    newIndex++;
  }

  let signatureValids: boolean[];
  const batchableBls = signatureSets.length >= chain.opts.minSameMessageSignatureSetsToBatch;
  if (batchableBls) {
    // all signature sets should have same signing root since we filtered in network processor
    signatureValids = await chain.bls.verifySignatureSetsSameMessage(
      signatureSets.map((set) => ({publicKey: set.pubkey, signature: set.signature})),
      signatureSets[0].signingRoot
    );
  } else {
    // don't want to block the main thread if there are too few signatures
    signatureValids = await Promise.all(
      signatureSets.map((set) => chain.bls.verifySignatureSets([set], {batchable: true}))
    );
  }

  // phase0 post validation
  for (const [i, sigValid] of signatureValids.entries()) {
    const oldIndex = newIndexToOldIndex.get(i);
    if (oldIndex == null) {
      // should not happen
      throw Error(`Cannot get old index for index ${i}`);
    }

    const {validatorIndex, attestation} = step0Results[i];
    const targetEpoch = attestation.data.target.epoch;
    if (sigValid) {
      // Now that the attestation has been fully verified, store that we have received a valid attestation from this validator.
      //
      // It's important to double check that the attestation still hasn't been observed, since
      // there can be a race-condition if we receive two attestations at the same time and
      // process them in different threads.
      if (chain.seenAttesters.isKnown(targetEpoch, validatorIndex)) {
        step0ResultOrErrors[oldIndex] = {
          err: new AttestationError(GossipAction.IGNORE, {
            code: AttestationErrorCode.ATTESTATION_ALREADY_KNOWN,
            targetEpoch,
            validatorIndex,
          }),
        };
      }

      // valid
      chain.seenAttesters.add(targetEpoch, validatorIndex);
    } else {
      step0ResultOrErrors[oldIndex] = {
        err: new AttestationError(GossipAction.IGNORE, {
          code: AttestationErrorCode.INVALID_SIGNATURE,
        }),
      };
    }
  }

  return {
    results: step0ResultOrErrors,
    batchableBls,
  };
}

/**
 * Validate attestations from api
 * - no need to deserialize attestation
 * - no subnet
 * - prioritize bls signature set
 */
export async function validateApiAttestation(
  fork: ForkName,
  chain: IBeaconChain,
  attestationOrBytes: ApiAttestation
): Promise<AttestationValidationResult> {
  const prioritizeBls = true;
  return validateAttestation(fork, chain, attestationOrBytes, null, prioritizeBls);
}

/**
 * Validate a single unaggregated attestation
 * subnet is null for api attestations
 */
export async function validateAttestation(
  fork: ForkName,
  chain: IBeaconChain,
  attestationOrBytes: AttestationOrBytes,
  subnet: number | null,
  prioritizeBls = false
): Promise<AttestationValidationResult> {
  try {
    const step0Result = await validateGossipAttestationNoSignatureCheck(fork, chain, attestationOrBytes, subnet);
    const {attestation, signatureSet, validatorIndex} = step0Result;
    const isValid = await chain.bls.verifySignatureSets([signatureSet], {batchable: true, priority: prioritizeBls});

    if (isValid) {
      const targetEpoch = attestation.data.target.epoch;
      chain.seenAttesters.add(targetEpoch, validatorIndex);
      return step0Result;
    } else {
      throw new AttestationError(GossipAction.IGNORE, {
        code: AttestationErrorCode.INVALID_SIGNATURE,
      });
    }
  } catch (err) {
    if (err instanceof EpochCacheError && err.type.code === EpochCacheErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE) {
      throw new AttestationError(GossipAction.IGNORE, {
        code: AttestationErrorCode.BAD_TARGET_EPOCH,
      });
    } else {
      throw err;
    }
  }
}

/**
 * Only deserialize the attestation if needed, use the cached AttestationData instead
 * This is to avoid deserializing similar attestation multiple times which could help the gc
 */
async function validateGossipAttestationNoSignatureCheck(
  fork: ForkName,
  chain: IBeaconChain,
  attestationOrBytes: AttestationOrBytes,
  /** Optional, to allow verifying attestations through API with unknown subnet */
  subnet: number | null
): Promise<Step0Result> {
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
  let attDataBase64: AttDataBase64 | null = null;
  if (attestationOrBytes.serializedData) {
    // gossip
    const attSlot = attestationOrBytes.attSlot;
    // for old LIFO linear gossip queue we don't have attDataBase64
    // for indexed gossip queue we have attDataBase64
    attDataBase64 =
      attestationOrBytes.attDataBase64 ?? getAttDataBase64FromAttestationSerialized(attestationOrBytes.serializedData);
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

  chain.metrics?.gossipAttestation.attestationSlotToClockSlot.observe(
    {caller: RegenCaller.validateGossipAttestation},
    chain.clock.currentSlot - attSlot
  );

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
    verifyPropagationSlotRange(fork, chain, attestationOrCache.attestation.data.slot);
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
      RegenCaller.validateGossipAttestation,
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

    const shuffling = await getShufflingForAttestationVerification(
      chain,
      attEpoch,
      attHeadBlock,
      RegenCaller.validateGossipAttestation
    );

    // [REJECT] The committee index is within the expected range
    // -- i.e. data.index < get_committee_count_per_slot(state, data.target.epoch)
    committeeIndices = getCommitteeIndices(shuffling, attSlot, attIndex);
    getSigningRoot = () => getAttestationDataSigningRoot(chain.config, attData);
    expectedSubnet = computeSubnetForSlot(shuffling, attSlot, attIndex);
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
  let signatureSet: SingleSignatureSet;
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

  // no signature check, leave that for step1
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
  return {attestation, indexedAttestation, subnet: expectedSubnet, attDataRootHex, signatureSet, validatorIndex};
}

/**
 * Verify that the `attestation` is within the acceptable gossip propagation range, with reference
 * to the current slot of the `chain`.
 *
 * Accounts for `MAXIMUM_GOSSIP_CLOCK_DISPARITY`.
 * Note: We do not queue future attestations for later processing
 */
export function verifyPropagationSlotRange(fork: ForkName, chain: IBeaconChain, attestationSlot: Slot): void {
  // slot with future tolerance of MAXIMUM_GOSSIP_CLOCK_DISPARITY_SEC
  const latestPermissibleSlot = chain.clock.slotWithFutureTolerance(MAXIMUM_GOSSIP_CLOCK_DISPARITY_SEC);
  if (attestationSlot > latestPermissibleSlot) {
    throw new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.FUTURE_SLOT,
      latestPermissibleSlot,
      attestationSlot,
    });
  }

  const earliestPermissibleSlot = Math.max(
    // slot with past tolerance of MAXIMUM_GOSSIP_CLOCK_DISPARITY_SEC
    // ATTESTATION_PROPAGATION_SLOT_RANGE = SLOTS_PER_EPOCH
    chain.clock.slotWithPastTolerance(MAXIMUM_GOSSIP_CLOCK_DISPARITY_SEC) - SLOTS_PER_EPOCH,
    0
  );

  // Post deneb the attestations are valid for current as well as previous epoch
  // while pre deneb they are valid for ATTESTATION_PROPAGATION_SLOT_RANGE
  //
  // see: https://github.com/ethereum/consensus-specs/pull/3360
  if (ForkSeq[fork] < ForkSeq.deneb) {
    if (attestationSlot < earliestPermissibleSlot) {
      throw new AttestationError(GossipAction.IGNORE, {
        code: AttestationErrorCode.PAST_SLOT,
        earliestPermissibleSlot,
        attestationSlot,
      });
    }
  } else {
    const attestationEpoch = computeEpochAtSlot(attestationSlot);

    // upper bound for current epoch is same as epoch of latestPermissibleSlot
    const latestPermissibleCurrentEpoch = computeEpochAtSlot(latestPermissibleSlot);
    if (attestationEpoch > latestPermissibleCurrentEpoch) {
      throw new AttestationError(GossipAction.IGNORE, {
        code: AttestationErrorCode.FUTURE_EPOCH,
        currentEpoch: latestPermissibleCurrentEpoch,
        attestationEpoch,
      });
    }

    // lower bound for previous epoch is same as epoch of earliestPermissibleSlot
    const earliestPermissiblePreviousEpoch = computeEpochAtSlot(earliestPermissibleSlot);
    if (attestationEpoch < earliestPermissiblePreviousEpoch) {
      throw new AttestationError(GossipAction.IGNORE, {
        code: AttestationErrorCode.PAST_EPOCH,
        previousEpoch: earliestPermissiblePreviousEpoch,
        attestationEpoch,
      });
    }
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
  caller: string,
  maxSkipSlots?: number
): ProtoBlock {
  const headBlock = verifyHeadBlockIsKnown(chain, beaconBlockRoot);
  // Lighthouse rejects the attestation, however Lodestar only ignores considering it's not against the spec
  // it's more about a DOS protection to us
  // With verifyPropagationSlotRange() and maxSkipSlots = 32, it's unlikely we have to regenerate states in queue
  // to validate beacon_attestation and aggregate_and_proof
  const slotDistance = attestationSlot - headBlock.slot;
  chain.metrics?.gossipAttestation.headSlotToAttestationSlot.observe({caller}, slotDistance);

  if (maxSkipSlots !== undefined && slotDistance > maxSkipSlots) {
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
 * Get a shuffling for attestation verification from the ShufflingCache.
 * - if blockEpoch is attEpoch, use current shuffling of head state
 * - if blockEpoch is attEpoch - 1, use next shuffling of head state
 * - if blockEpoch is less than attEpoch - 1, dial head state to attEpoch - 1, and add to ShufflingCache
 *
 * This implementation does not require to dial head state to attSlot at fork boundary because we always get domain of attSlot
 * in consumer context.
 *
 * This is similar to the old getStateForAttestationVerification
 * see https://github.com/ChainSafe/lodestar/blob/v1.11.3/packages/beacon-node/src/chain/validation/attestation.ts#L566
 */
export async function getShufflingForAttestationVerification(
  chain: IBeaconChain,
  attEpoch: Epoch,
  attHeadBlock: ProtoBlock,
  regenCaller: RegenCaller
): Promise<EpochShuffling> {
  const blockEpoch = computeEpochAtSlot(attHeadBlock.slot);
  const shufflingDependentRoot = getShufflingDependentRoot(chain.forkChoice, attEpoch, blockEpoch, attHeadBlock);

  const shuffling = await chain.shufflingCache.get(attEpoch, shufflingDependentRoot);
  if (shuffling) {
    // most of the time, we should get the shuffling from cache
    chain.metrics?.gossipAttestation.shufflingCacheHit.inc({caller: regenCaller});
    return shuffling;
  }

  chain.metrics?.gossipAttestation.shufflingCacheMiss.inc({caller: regenCaller});
  try {
    // for the 1st time of the same epoch and dependent root, it awaits for the regen state
    // from the 2nd time, it should use the same cached promise and it should reach the above code
    chain.metrics?.gossipAttestation.shufflingCacheRegenHit.inc({caller: regenCaller});
    return await chain.regenStateForAttestationVerification(
      attEpoch,
      shufflingDependentRoot,
      attHeadBlock,
      regenCaller
    );
  } catch (e) {
    chain.metrics?.gossipAttestation.shufflingCacheRegenMiss.inc({caller: regenCaller});
    throw new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.MISSING_STATE_TO_VERIFY_ATTESTATION,
      error: e as Error,
    });
  }
}

/**
 * Different version of getAttestationDataSigningRoot in state-transition which doesn't require a state.
 */
export function getAttestationDataSigningRoot(config: BeaconConfig, data: phase0.AttestationData): Uint8Array {
  const slot = computeStartSlotAtEpoch(data.target.epoch);
  // previously, we call `domain = config.getDomain(state.slot, DOMAIN_BEACON_ATTESTER, slot)`
  // at fork boundary, it's required to dial to target epoch https://github.com/ChainSafe/lodestar/blob/v1.11.3/packages/beacon-node/src/chain/validation/attestation.ts#L573
  // instead of that, just use the fork at slot in the attestation data
  const fork = config.getForkName(slot);
  const domain = config.getDomainAtFork(fork, DOMAIN_BEACON_ATTESTER);
  return computeSigningRoot(ssz.phase0.AttestationData, data, domain);
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
      root: toHexString(beaconBlockRoot),
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
  shuffling: EpochShuffling,
  attestationSlot: Slot,
  attestationIndex: number
): number[] {
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
export function computeSubnetForSlot(shuffling: EpochShuffling, slot: number, committeeIndex: number): number {
  const slotsSinceEpochStart = slot % SLOTS_PER_EPOCH;
  const committeesSinceEpochStart = shuffling.committeesPerSlot * slotsSinceEpochStart;
  return (committeesSinceEpochStart + committeeIndex) % ATTESTATION_SUBNET_COUNT;
}
