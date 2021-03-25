import {BLSPubkey, phase0} from "@chainsafe/lodestar-types";

export interface ISlashingProtection {
  /**
   * Check a block proposal for slash safety, and if it is safe, record it in the database
   */
  checkAndInsertBlockProposal(pubKey: BLSPubkey, block: phase0.SlashingProtectionBlock): Promise<void>;
  /**
   * Check an attestation for slash safety, and if it is safe, record it in the database
   */
  checkAndInsertAttestation(pubKey: BLSPubkey, attestation: phase0.SlashingProtectionAttestation): Promise<void>;
}
