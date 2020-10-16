import {BLSPubkey, SlashingProtectionAttestation, SlashingProtectionBlock} from "@chainsafe/lodestar-types";

export interface ISlashingProtection {
  /**
   * Check a block proposal for slash safety, and if it is safe, record it in the database
   */
  checkAndInsertBlockProposal(pubKey: BLSPubkey, block: SlashingProtectionBlock): Promise<void>;
  /**
   * Check an attestation for slash safety, and if it is safe, record it in the database
   */
  checkAndInsertAttestation(pubKey: BLSPubkey, attestation: SlashingProtectionAttestation): Promise<void>;
}
