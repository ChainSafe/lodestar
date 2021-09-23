import {BLSPubkey} from "@chainsafe/lodestar-types";
import {SafeStatus} from "./attestation";
import {SlashingProtectionBlock, SlashingProtectionAttestation} from "./types";

export interface ISlashingProtection {
  /**
   * Check a block proposal for slash safety, and if it is safe, record it in the database
   */
  checkAndInsertBlockProposal(pubKey: BLSPubkey, block: SlashingProtectionBlock): Promise<void>;
  /**
   * Check an attestation for slash safety
   */
  checkAttestation(pubKey: BLSPubkey, attestation: SlashingProtectionAttestation): Promise<SafeStatus>;
  /**
   * If it is safe, record it in the database
   */
  insertAttestation(pubKey: BLSPubkey, attestation: SlashingProtectionAttestation): Promise<void>;
}
