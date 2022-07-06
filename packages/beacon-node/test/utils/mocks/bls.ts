import {IBlsVerifier} from "../../../src/chain/bls/index.js";

export class BlsVerifierMock implements IBlsVerifier {
  constructor(private readonly isValidResult: boolean) {}

  async verifySignatureSets(): Promise<boolean> {
    return this.isValidResult;
  }

  async close(): Promise<void> {
    //
  }
}
