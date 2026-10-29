import {EXECUTION_PROOF_TYPES} from "@lodestar/params";
import {eip8025} from "@lodestar/types";
import {ProofEngine} from "./interface.js";

export class NoopProofEngine implements ProofEngine {
  readonly supportedProofTypes: ReadonlySet<eip8025.ProofType> = new Set(EXECUTION_PROOF_TYPES.keys());
  readonly verifiableProofTypes: ReadonlySet<eip8025.ProofType> = new Set();

  async verifyExecutionProof(): Promise<boolean> {
    return false;
  }
}
