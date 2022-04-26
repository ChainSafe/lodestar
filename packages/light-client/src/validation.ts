import {altair, phase0, Root, Slot, ssz} from "@chainsafe/lodestar-types";
import {PublicKey, Signature} from "@chainsafe/bls";
import {
  FINALIZED_ROOT_INDEX,
  FINALIZED_ROOT_DEPTH,
  NEXT_SYNC_COMMITTEE_INDEX,
  NEXT_SYNC_COMMITTEE_DEPTH,
  MIN_SYNC_COMMITTEE_PARTICIPANTS,
  DOMAIN_SYNC_COMMITTEE,
} from "@chainsafe/lodestar-params";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {routes} from "@chainsafe/lodestar-api";

import {isValidMerkleBranch} from "./utils/verifyMerkleBranch";
import {assertZeroHashes, getParticipantPubkeys, isEmptyHeader} from "./utils/utils";
import {SyncCommitteeFast} from "./types";
import {computeSyncPeriodAtSlot} from "./utils/clock";

/**
 *
 * @param syncCommittee SyncPeriod that signed this update: `computeSyncPeriodAtSlot(update.header.slot) - 1`
 * @param forkVersion ForkVersion that was used to sign the update
 */
export function assertValidLightClientUpdate(
  config: IBeaconConfig,
  syncCommittee: SyncCommitteeFast,
  update: altair.LightClientUpdate
): void {
  // DIFF FROM SPEC: An update with the same header.slot can be valid and valuable to the lightclient
  // It may have more consensus and result in a better snapshot whilst not advancing the state
  // ----
  // Verify update slot is larger than snapshot slot
  // if (update.header.slot <= snapshot.header.slot) {
  //   throw Error("update slot is less or equal snapshot slot");
  // }

  // Verify update header root is the finalized root of the finality header, if specified
  const isFinalized = !isEmptyHeader(update.finalizedHeader);
  if (isFinalized) {
    assertValidFinalityProof(update);
  } else {
    assertZeroHashes(update.finalityBranch, FINALIZED_ROOT_DEPTH, "finalityBranches");
  }

  // DIFF FROM SPEC:
  // The nextSyncCommitteeBranch should be check always not only when updatePeriodIncremented
  // An update may not increase the period but still be stored in validUpdates and be used latter
  assertValidSyncCommitteeProof(update);

  const {attestedHeader} = update;
  const headerBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(attestedHeader);
  assertValidSignedHeader(config, syncCommittee, update.syncAggregate, headerBlockRoot, attestedHeader.slot);
}

/**
 * Proof that the state referenced in `update.finalityHeader.stateRoot` includes
 * ```ts
 * state = {
 *   finalizedCheckpoint: {
 *     root: update.header
 *   }
 * }
 * ```
 *
 * Where `hashTreeRoot(state) == update.finalityHeader.stateRoot`
 */
export function assertValidFinalityProof(update: routes.lightclient.LightclientFinalizedUpdate): void {
  if (
    !isValidMerkleBranch(
      ssz.phase0.BeaconBlockHeader.hashTreeRoot(update.finalizedHeader),
      update.finalityBranch,
      FINALIZED_ROOT_DEPTH,
      FINALIZED_ROOT_INDEX,
      update.attestedHeader.stateRoot
    )
  ) {
    throw Error("Invalid finality header merkle branch");
  }

  const updatePeriod = computeSyncPeriodAtSlot(update.attestedHeader.slot);
  const updateFinalityPeriod = computeSyncPeriodAtSlot(update.finalizedHeader.slot);
  if (updateFinalityPeriod !== updatePeriod) {
    throw Error(`finalityHeader period ${updateFinalityPeriod} != header period ${updatePeriod}`);
  }
}

/**
 * Proof that the state referenced in `update.header.stateRoot` includes
 * ```ts
 * state = {
 *   nextSyncCommittee: update.nextSyncCommittee
 * }
 * ```
 *
 * Where `hashTreeRoot(state) == update.header.stateRoot`
 */
export function assertValidSyncCommitteeProof(update: altair.LightClientUpdate): void {
  if (
    !isValidMerkleBranch(
      ssz.altair.SyncCommittee.hashTreeRoot(update.nextSyncCommittee),
      update.nextSyncCommitteeBranch,
      NEXT_SYNC_COMMITTEE_DEPTH,
      NEXT_SYNC_COMMITTEE_INDEX,
      activeHeader(update).stateRoot
    )
  ) {
    throw Error("Invalid next sync committee merkle branch");
  }
}

/**
 * The "active header" is the header that the update is trying to convince us
 * to accept. If a finalized header is present, it's the finalized header,
 * otherwise it's the attested header
 * @param update
 */
export function activeHeader(update: altair.LightClientUpdate): phase0.BeaconBlockHeader {
  if (!isEmptyHeader(update.finalizedHeader)) {
    return update.finalizedHeader;
  }

  return update.attestedHeader;
}

/**
 * Assert valid signature for `signedHeader` with provided `syncCommittee`.
 *
 * update.syncCommitteeSignature signs over the block at the previous slot of the state it is included.
 * ```py
 * previous_slot = max(state.slot, Slot(1)) - Slot(1)
 * domain = get_domain(state, DOMAIN_SYNC_COMMITTEE, compute_epoch_at_slot(previous_slot))
 * signing_root = compute_signing_root(get_block_root_at_slot(state, previous_slot), domain)
 * ```
 * Ref: https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/beacon-chain.md#sync-aggregate-processing
 *
 * @param syncCommittee SyncPeriod that signed this update: `computeSyncPeriodAtSlot(update.header.slot) - 1`
 * @param forkVersion ForkVersion that was used to sign the update
 * @param signedHeaderRoot Takes header root instead of the head itself to prevent re-hashing on SSE
 */
export function assertValidSignedHeader(
  config: IBeaconConfig,
  syncCommittee: SyncCommitteeFast,
  syncAggregate: altair.SyncAggregate,
  signedHeaderRoot: Root,
  signedHeaderSlot: Slot
): void {
  const participantPubkeys = getParticipantPubkeys(syncCommittee.pubkeys, syncAggregate.syncCommitteeBits);

  // Verify sync committee has sufficient participants.
  // SyncAggregates included in blocks may have zero participants
  if (participantPubkeys.length < MIN_SYNC_COMMITTEE_PARTICIPANTS) {
    throw Error("Sync committee has not sufficient participants");
  }

  const signingRoot = ssz.phase0.SigningData.hashTreeRoot({
    objectRoot: signedHeaderRoot,
    domain: config.getDomain(DOMAIN_SYNC_COMMITTEE, signedHeaderSlot),
  });

  if (!isValidBlsAggregate(participantPubkeys, signingRoot, syncAggregate.syncCommitteeSignature)) {
    throw Error("Invalid aggregate signature");
  }
}

/**
 * Same as BLS.verifyAggregate but with detailed error messages
 */
function isValidBlsAggregate(publicKeys: PublicKey[], message: Uint8Array, signature: Uint8Array): boolean {
  let aggPubkey: PublicKey;
  try {
    aggPubkey = PublicKey.aggregate(publicKeys);
  } catch (e) {
    (e as Error).message = `Error aggregating pubkeys: ${(e as Error).message}`;
    throw e;
  }

  let sig: Signature;
  try {
    sig = Signature.fromBytes(signature, undefined, true);
  } catch (e) {
    (e as Error).message = `Error deserializing signature: ${(e as Error).message}`;
    throw e;
  }

  try {
    return sig.verify(aggPubkey, message);
  } catch (e) {
    (e as Error).message = `Error verifying signature: ${(e as Error).message}`;
    throw e;
  }
}
