import {Root, ssz, allForks} from "@lodestar/types";
import bls from "@chainsafe/bls/switchable";
import type {PublicKey, Signature} from "@chainsafe/bls/types";
import {
  FINALIZED_ROOT_INDEX,
  FINALIZED_ROOT_DEPTH,
  NEXT_SYNC_COMMITTEE_INDEX,
  NEXT_SYNC_COMMITTEE_DEPTH,
  MIN_SYNC_COMMITTEE_PARTICIPANTS,
  DOMAIN_SYNC_COMMITTEE,
  GENESIS_SLOT,
} from "@lodestar/params";
import {getParticipantPubkeys, sumBits} from "../utils/utils.js";
import {isValidMerkleBranch} from "../utils/index.js";
import {SyncCommitteeFast} from "../types.js";
import {isFinalityUpdate, isSyncCommitteeUpdate, isZeroedHeader, isZeroedSyncCommittee, ZERO_HASH} from "./utils.js";
import {ILightClientStore} from "./store.js";

export function validateLightClientUpdate(
  store: ILightClientStore,
  update: allForks.LightClientUpdate,
  syncCommittee: SyncCommitteeFast
): void {
  // Verify sync committee has sufficient participants
  if (sumBits(update.syncAggregate.syncCommitteeBits) < MIN_SYNC_COMMITTEE_PARTICIPANTS) {
    throw Error("Sync committee has not sufficient participants");
  }

  // Sanity check that slots are in correct order
  if (update.signatureSlot <= update.attestedHeader.beacon.slot) {
    throw Error(
      `signature slot ${update.signatureSlot} must be after attested header slot ${update.attestedHeader.beacon.slot}`
    );
  }
  if (update.attestedHeader.beacon.slot < update.finalizedHeader.beacon.slot) {
    throw Error(
      `attested header slot ${update.signatureSlot} must be after finalized header slot ${update.finalizedHeader.beacon.slot}`
    );
  }

  // Verify that the `finality_branch`, if present, confirms `finalized_header`
  // to match the finalized checkpoint root saved in the state of `attested_header`.
  // Note that the genesis finalized checkpoint root is represented as a zero hash.
  if (!isFinalityUpdate(update)) {
    if (!isZeroedHeader(update.finalizedHeader.beacon)) {
      throw Error("finalizedHeader must be zero for non-finality update");
    }
  } else {
    let finalizedRoot: Root;

    if (update.finalizedHeader.beacon.slot == GENESIS_SLOT) {
      if (!isZeroedHeader(update.finalizedHeader.beacon)) {
        throw Error("finalizedHeader must be zero for not finality update");
      }
      finalizedRoot = ZERO_HASH;
    } else {
      finalizedRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(update.finalizedHeader.beacon);
    }

    if (
      !isValidMerkleBranch(
        finalizedRoot,
        update.finalityBranch,
        FINALIZED_ROOT_DEPTH,
        FINALIZED_ROOT_INDEX,
        update.attestedHeader.beacon.stateRoot
      )
    ) {
      throw Error("Invalid finality header merkle branch");
    }
  }

  // Verify that the `next_sync_committee`, if present, actually is the next sync committee saved in the
  // state of the `attested_header`
  if (!isSyncCommitteeUpdate(update)) {
    if (!isZeroedSyncCommittee(update.nextSyncCommittee)) {
      throw Error("nextSyncCommittee must be zero for non sync committee update");
    }
  } else {
    if (
      !isValidMerkleBranch(
        ssz.altair.SyncCommittee.hashTreeRoot(update.nextSyncCommittee),
        update.nextSyncCommitteeBranch,
        NEXT_SYNC_COMMITTEE_DEPTH,
        NEXT_SYNC_COMMITTEE_INDEX,
        update.attestedHeader.beacon.stateRoot
      )
    ) {
      throw Error("Invalid next sync committee merkle branch");
    }
  }

  // Verify sync committee aggregate signature

  const participantPubkeys = getParticipantPubkeys(syncCommittee.pubkeys, update.syncAggregate.syncCommitteeBits);

  const signingRoot = ssz.phase0.SigningData.hashTreeRoot({
    objectRoot: ssz.phase0.BeaconBlockHeader.hashTreeRoot(update.attestedHeader.beacon),
    domain: store.config.getDomain(update.signatureSlot, DOMAIN_SYNC_COMMITTEE),
  });

  if (!isValidBlsAggregate(participantPubkeys, signingRoot, update.syncAggregate.syncCommitteeSignature)) {
    throw Error("Invalid aggregate signature");
  }
}

/**
 * Same as BLS.verifyAggregate but with detailed error messages
 */
function isValidBlsAggregate(publicKeys: PublicKey[], message: Uint8Array, signature: Uint8Array): boolean {
  let aggPubkey: PublicKey;
  try {
    aggPubkey = bls.PublicKey.aggregate(publicKeys);
  } catch (e) {
    (e as Error).message = `Error aggregating pubkeys: ${(e as Error).message}`;
    throw e;
  }

  let sig: Signature;
  try {
    sig = bls.Signature.fromBytes(signature, undefined, true);
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
