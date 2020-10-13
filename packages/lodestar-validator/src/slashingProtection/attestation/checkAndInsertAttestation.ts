import {BLSPubkey, SlashingProtectionAttestation} from "@chainsafe/lodestar-types";
import {isEqualRoot, isZeroRoot, minEpoch} from "../utils";
import {InvalidAttestationError, InvalidAttestationErrorCode} from "./errors";
import {SlashingProtectionAttestationRepository} from "./dbRepository";

/**
 * Check an attestation for slash safety, and if it is safe, record it in the database
 */
export async function checkAndInsertAttestation(
  pubKey: BLSPubkey,
  att: SlashingProtectionAttestation,
  signedAttestationDb: SlashingProtectionAttestationRepository
): Promise<void> {
  // Potential slashing attestation range (with s2 < t2, s1 < t1)
  // - Double vote
  //   t1 = t2
  // - new [s2,t2] surrounds prev [s1,t1]
  //   0 <= s2 < s1
  //   t1 < t2
  // - prev [s1,t1] surrounds new [s2,t2]
  //   s1 < s2 < t1 - 1
  //   s1 + 1 < t2 < t1
  //
  // Merging those ranges
  //   0 <= s2 < t1 - 1
  //   s1 + 1 <= t2
  // EDIT: fetch the entire range or tests do not pass
  const potentialAttestationConflicts = await signedAttestationDb.getByPubkeyAndTargetEpoch(pubKey, {});

  // Although it's not required to avoid slashing, we disallow attestations
  // which are obviously invalid by virtue of their source epoch exceeding their target.
  if (att.sourceEpoch > att.targetEpoch) {
    throw new InvalidAttestationError({code: InvalidAttestationErrorCode.SOURCE_EXCEEDS_TARGET});
  }

  for (const prev of potentialAttestationConflicts) {
    // Double vote
    if (att.targetEpoch === prev.targetEpoch) {
      // Interchange format allows for attestations without signing_root, then assume root is equal
      if (!isZeroRoot(prev.signingRoot) && isEqualRoot(att.signingRoot, prev.signingRoot)) {
        return; // Ok, same data
      } else {
        throw new InvalidAttestationError({code: InvalidAttestationErrorCode.DOUBLE_VOTE, att, prev});
      }
    }

    // Surround vote
    if (prev.sourceEpoch < att.sourceEpoch && prev.targetEpoch > att.targetEpoch) {
      throw new InvalidAttestationError({code: InvalidAttestationErrorCode.PREV_SURROUNDS_NEW, att, prev});
    }
    if (prev.sourceEpoch > att.sourceEpoch && prev.targetEpoch < att.targetEpoch) {
      throw new InvalidAttestationError({code: InvalidAttestationErrorCode.NEW_SURROUNDS_PREV, att, prev});
    }
  }

  // Refuse to sign any attestation with:
  // - source.epoch < min(att.source_epoch for att in data.signed_attestations if att.pubkey == attester_pubkey), OR
  // - target_epoch <= min(att.target_epoch for att in data.signed_attestations if att.pubkey == attester_pubkey)
  // (spec v4, Slashing Protection Database Interchange Format)
  const minSourceEpoch = minEpoch(potentialAttestationConflicts.map((att) => att.sourceEpoch));
  if (minSourceEpoch && att.sourceEpoch < minSourceEpoch) {
    throw new InvalidAttestationError({
      code: InvalidAttestationErrorCode.SOURCE_LESS_THAN_LOWER_BOUND,
      sourceEpoch: att.sourceEpoch,
      minSourceEpoch,
    });
  }

  const minTargetEpoch = minEpoch(potentialAttestationConflicts.map((att) => att.targetEpoch));
  if (minTargetEpoch && att.targetEpoch <= minTargetEpoch) {
    throw new InvalidAttestationError({
      code: InvalidAttestationErrorCode.TARGET_LESS_THAN_OR_EQ_LOWER_BOUND,
      targetEpoch: att.targetEpoch,
      minTargetEpoch,
    });
  }

  // Attestation is safe, add to DB
  await signedAttestationDb.setByPubkey(pubKey, [att]);

  // TODO: Implement safe clean-up of stored attestations
}
