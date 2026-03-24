import {EXECUTION_PROOF_TYPE_COUNT} from "@lodestar/params";
import {SignedExecutionProof} from "@lodestar/types";
import {MapDef, toRootHex} from "@lodestar/utils";
import {InsertOutcome} from "./types.js";

type RequestRootHex = string;
type ProofType = number;

/**
 * EIP-8025: In-memory pool for signed execution proofs,
 * indexed by newPayloadRequestRoot → proofType.
 */
export class ExecutionProofPool {
  private readonly proofsByRequestRoot = new MapDef<RequestRootHex, Map<ProofType, SignedExecutionProof>>(
    () => new Map()
  );

  get size(): number {
    let count = 0;
    for (const byProofType of this.proofsByRequestRoot.values()) {
      count += byProofType.size;
    }
    return count;
  }

  add(signedProof: SignedExecutionProof): InsertOutcome {
    const {proofType} = signedProof.message;
    if (proofType >= EXECUTION_PROOF_TYPE_COUNT) {
      return InsertOutcome.Old;
    }

    const requestRootHex = toRootHex(signedProof.message.publicInput.newPayloadRequestRoot);
    const byProofType = this.proofsByRequestRoot.getOrDefault(requestRootHex);

    if (byProofType.has(proofType)) {
      return InsertOutcome.AlreadyKnown;
    }

    byProofType.set(proofType, signedProof);
    return InsertOutcome.NewData;
  }

  getByRequestRoot(requestRoot: Uint8Array): SignedExecutionProof[] {
    const hex = toRootHex(requestRoot);
    const byProofType = this.proofsByRequestRoot.get(hex);
    return byProofType ? Array.from(byProofType.values()) : [];
  }

  getByRequestRootHex(requestRootHex: RequestRootHex): SignedExecutionProof[] {
    const byProofType = this.proofsByRequestRoot.get(requestRootHex);
    return byProofType ? Array.from(byProofType.values()) : [];
  }

  getAll(): SignedExecutionProof[] {
    const all: SignedExecutionProof[] = [];
    for (const byProofType of this.proofsByRequestRoot.values()) {
      for (const proof of byProofType.values()) {
        all.push(proof);
      }
    }
    return all;
  }

  hasEnoughProofs(requestRoot: Uint8Array, minRequired: number): boolean {
    const hex = toRootHex(requestRoot);
    const byProofType = this.proofsByRequestRoot.get(hex);
    return byProofType !== undefined && byProofType.size >= minRequired;
  }

  has(requestRoot: Uint8Array, proofType: ProofType): boolean {
    const hex = toRootHex(requestRoot);
    return this.proofsByRequestRoot.get(hex)?.has(proofType) ?? false;
  }

  pruneByRequestRoots(rootsToPrune: Set<Uint8Array>): void {
    for (const root of rootsToPrune) {
      this.proofsByRequestRoot.delete(toRootHex(root));
    }
  }

  /** Prune all roots not in the active set */
  pruneKeepOnly(activeRootHexes: Set<RequestRootHex>): void {
    for (const hex of this.proofsByRequestRoot.keys()) {
      if (!activeRootHexes.has(hex)) {
        this.proofsByRequestRoot.delete(hex);
      }
    }
  }
}
