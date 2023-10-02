import {BLSPubkey, Epoch} from "@lodestar/types";
import {ISlashingProtection} from "../../src/index.js";

/**
 * Mock slashing protection that always accepts all messages
 */
export class SlashingProtectionMock implements ISlashingProtection {
  async checkAndInsertBlockProposal(): Promise<void> {
    //
  }
  async checkAndInsertAttestation(): Promise<void> {
    //
  }
  async hasAttestedInEpoch(_p: BLSPubkey, _e: Epoch): Promise<boolean> {
    return false;
  }
  async importInterchange(): Promise<void> {
    //
  }
  async exportInterchange(): Promise<never> {
    throw Error("disabled");
  }
}
