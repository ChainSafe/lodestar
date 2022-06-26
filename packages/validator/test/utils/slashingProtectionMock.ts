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
  async importInterchange(): Promise<void> {
    //
  }
  async exportInterchange(): Promise<never> {
    throw Error("disabled");
  }
}
