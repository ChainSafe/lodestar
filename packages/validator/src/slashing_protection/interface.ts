import {BLSPubkey, Root} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
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

  importInterchange(interchange: Interchange, genesisValidatorsRoot: Uint8Array | Root, logger?: Logger): Promise<void>;
  exportInterchange(
    genesisValidatorsRoot: Uint8Array | Root,
    pubkeys: BLSPubkey[],
    formatVersion: InterchangeFormatVersion,
    logger?: Logger
  ): Promise<Interchange>;
}
