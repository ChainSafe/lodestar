import {ISignatureSet} from "@lodestar/state-transition";
import {IBlsVerifier} from "../../../src/chain/bls/index.js";

export class BlsVerifierMock implements IBlsVerifier {
  constructor(private readonly isValidResult: boolean) {}

  async verifySignatureSetsSameSigningRoot(sets: ISignatureSet[]): Promise<boolean[]> {
    return this.isValidResult ? sets.map(() => true) : sets.map(() => false);
  }

  async verifySignatureSets(): Promise<boolean> {
    return this.isValidResult;
  }

  async close(): Promise<void> {
    //
  }

  canAcceptWork(): boolean {
    return true;
  }
}
