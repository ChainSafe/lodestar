import {eip8025} from "@lodestar/types";
import {ProofEngine} from "./interface.js";

export class NoopProofEngine implements ProofEngine {
  readonly verifiableProofTypes: ReadonlySet<eip8025.ProofType> = new Set();

  async verifyExecutionProof(): Promise<boolean> {
    return false;
  }
}
