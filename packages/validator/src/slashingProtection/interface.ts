import {BLSPubkey, Root} from "@chainsafe/lodestar-types";
import {Interchange, InterchangeFormatVersion} from "./interchange/types.js";
import {SlashingProtectionBlock, SlashingProtectionAttestation} from "./types.js";

export interface ISlashingProtection {
  /**
   * Check a block proposal for slash safety, and if it is safe, record it in the database
   */
  checkAndInsertBlockProposal(pubKey: BLSPubkey, block: SlashingProtectionBlock): Promise<void>;
  /**
   * Check an attestation for slash safety, and if it is safe, record it in the database
   */
  checkAndInsertAttestation(pubKey: BLSPubkey, attestation: SlashingProtectionAttestation): Promise<void>;

  importInterchange(interchange: Interchange, genesisValidatorsRoot: Uint8Array | Root): Promise<void>;
  exportInterchange(
    genesisValidatorsRoot: Uint8Array | Root,
    pubkeys: BLSPubkey[],
    formatVersion: InterchangeFormatVersion
  ): Promise<Interchange>;
}
