import {BLSPubkey} from "@chainsafe/lodestar-types";
import {isEqualNonZeroRoot, minEpoch} from "../utils.js";
import {MinMaxSurround, SurroundAttestationError, SurroundAttestationErrorCode} from "../minMaxSurround/index.js";
import {SlashingProtectionAttestation} from "../types.js";
import {InvalidAttestationError, InvalidAttestationErrorCode} from "./errors.js";
import {AttestationByTargetRepository} from "./attestationByTargetRepository.js";
import {AttestationLowerBoundRepository} from "./attestationLowerBoundRepository.js";
export {
  AttestationByTargetRepository,
  AttestationLowerBoundRepository,
  InvalidAttestationError,
  InvalidAttestationErrorCode,
};

enum SafeStatus {
  SAME_DATA = "SAFE_STATUS_SAME_DATA",
  OK = "SAFE_STATUS_OK",
}

export class SlashingProtectionAttestationService {
  private attestationByTarget: AttestationByTargetRepository;
  private attestationLowerBound: AttestationLowerBoundRepository;
  private minMaxSurround: MinMaxSurround;

  constructor(
    signedAttestationDb: AttestationByTargetRepository,
    attestationLowerBound: AttestationLowerBoundRepository,
    minMaxSurround: MinMaxSurround
  ) {
    this.attestationByTarget = signedAttestationDb;
    this.attestationLowerBound = attestationLowerBound;
    this.minMaxSurround = minMaxSurround;
  }

  /**
   * Check an attestation for slash safety, and if it is safe, record it in the database
   * This is the safe, externally-callable interface for checking attestations
   */
  async checkAndInsertAttestation(pubKey: BLSPubkey, attestation: SlashingProtectionAttestation): Promise<void> {
    const safeStatus = await this.checkAttestation(pubKey, attestation);

    if (safeStatus != SafeStatus.SAME_DATA) {
      await this.insertAttestation(pubKey, attestation);
    }

    // TODO: Implement safe clean-up of stored attestations
  }

  /**
   * Check an attestation from `pubKey` for slash safety.
   */
  async checkAttestation(pubKey: BLSPubkey, attestation: SlashingProtectionAttestation): Promise<SafeStatus> {
    // Although it's not required to avoid slashing, we disallow attestations
    // which are obviously invalid by virtue of their source epoch exceeding their target.
    if (attestation.sourceEpoch > attestation.targetEpoch) {
      throw new InvalidAttestationError({code: InvalidAttestationErrorCode.SOURCE_EXCEEDS_TARGET});
    }

    // Check for a double vote. Namely, an existing attestation with the same target epoch,
    // and a different signing root.
    const sameTargetAtt = await this.attestationByTarget.get(pubKey, attestation.targetEpoch);
    if (sameTargetAtt) {
      // Interchange format allows for attestations without signing_root, then assume root is equal
      if (isEqualNonZeroRoot(sameTargetAtt.signingRoot, attestation.signingRoot)) {
        return SafeStatus.SAME_DATA;
      } else {
        throw new InvalidAttestationError({
          code: InvalidAttestationErrorCode.DOUBLE_VOTE,
          attestation: attestation,
          prev: sameTargetAtt,
        });
      }
    }

    // Check for a surround vote
    try {
      await this.minMaxSurround.assertNoSurround(pubKey, attestation);
    } catch (e) {
      if (e instanceof SurroundAttestationError) {
        const prev = await this.attestationByTarget.get(pubKey, e.type.attestation2Target).catch(() => null);
        switch (e.type.code) {
          case SurroundAttestationErrorCode.IS_SURROUNDING:
            throw new InvalidAttestationError({
              code: InvalidAttestationErrorCode.NEW_SURROUNDS_PREV,
              attestation,
              prev,
            });
          case SurroundAttestationErrorCode.IS_SURROUNDED:
            throw new InvalidAttestationError({
              code: InvalidAttestationErrorCode.PREV_SURROUNDS_NEW,
              attestation,
              prev,
            });
        }
      }
      throw e;
    }

    // Refuse to sign any attestation with:
    // - source.epoch < min(att.source_epoch for att in data.signed_attestations if att.pubkey == attester_pubkey), OR
    // - target_epoch <= min(att.target_epoch for att in data.signed_attestations if att.pubkey == attester_pubkey)
    // (spec v4, Slashing Protection Database Interchange Format)
    const attestationLowerBound = await this.attestationLowerBound.get(pubKey);
    if (attestationLowerBound) {
      const {minSourceEpoch, minTargetEpoch} = attestationLowerBound;
      if (attestation.sourceEpoch < minSourceEpoch) {
        throw new InvalidAttestationError({
          code: InvalidAttestationErrorCode.SOURCE_LESS_THAN_LOWER_BOUND,
          sourceEpoch: attestation.sourceEpoch,
          minSourceEpoch,
        });
      }

      if (attestation.targetEpoch <= minTargetEpoch) {
        throw new InvalidAttestationError({
          code: InvalidAttestationErrorCode.TARGET_LESS_THAN_OR_EQ_LOWER_BOUND,
          targetEpoch: attestation.targetEpoch,
          minTargetEpoch,
        });
      }
    }

    return SafeStatus.OK;
  }

  /**
   * Insert an attestation into the slashing database
   * This should *only* be called in the same (exclusive) transaction as `checkAttestation`
   * so that the check isn't invalidated by a concurrent mutation
   */
  async insertAttestation(pubKey: BLSPubkey, attestation: SlashingProtectionAttestation): Promise<void> {
    await this.attestationByTarget.set(pubKey, [attestation]);
    await this.minMaxSurround.insertAttestation(pubKey, attestation);
  }

  /**
   * Interchange import / export functionality
   */
  async importAttestations(pubkey: BLSPubkey, attestations: SlashingProtectionAttestation[]): Promise<void> {
    await this.attestationByTarget.set(pubkey, attestations);

    // Pre-compute spans for all attestations
    for (const attestation of attestations) {
      await this.minMaxSurround.insertAttestation(pubkey, attestation);
    }

    // Pre-compute and store lower-bound
    const minSourceEpoch = minEpoch(attestations.map((attestation) => attestation.sourceEpoch));
    const minTargetEpoch = minEpoch(attestations.map((attestation) => attestation.targetEpoch));
    if (minSourceEpoch != null && minTargetEpoch != null) {
      await this.attestationLowerBound.set(pubkey, {minSourceEpoch, minTargetEpoch});
    }
  }

  /**
   * Interchange import / export functionality
   */
  async exportAttestations(pubkey: BLSPubkey): Promise<SlashingProtectionAttestation[]> {
    return await this.attestationByTarget.getAll(pubkey);
  }

  async listPubkeys(): Promise<BLSPubkey[]> {
    return await this.attestationByTarget.listPubkeys();
  }
}
