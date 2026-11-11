import {XMSS_CLAIM_SIZE, verifyXmssAggregate} from "@lodestar/native/leanvm";
import {XmssProofSet, XmssSignatureSet, verifyXmssSignatureSet} from "@lodestar/state-transition";

/**
 * Verifies what a pq block or gossip message asks a node to take on trust, outside the state
 * transition: leanXMSS signatures and proofs of sets of them.
 */
export interface IPqVerifier {
  /** Resolves true only if every signature is valid at the leaf its message is assigned */
  verifySignatureSets(sets: XmssSignatureSet[]): Promise<boolean>;
  /** Resolves true only if every proof covers all of its claims */
  verifyProofSets(sets: XmssProofSet[]): Promise<boolean>;
}

/**
 * Sorts packed claims and drops duplicates: a proof is of a set of claims, and the prover fixes
 * the set's order.
 */
export function canonicalClaims(claims: Uint8Array): Uint8Array {
  const count = claims.length / XMSS_CLAIM_SIZE;
  if (!Number.isInteger(count)) throw Error(`Claims are not a multiple of ${XMSS_CLAIM_SIZE} bytes`);

  const buffer = Buffer.from(claims.buffer, claims.byteOffset, claims.length);
  const order = Array.from({length: count}, (_, i) => i).sort((a, b) =>
    buffer.compare(
      buffer,
      b * XMSS_CLAIM_SIZE,
      (b + 1) * XMSS_CLAIM_SIZE,
      a * XMSS_CLAIM_SIZE,
      (a + 1) * XMSS_CLAIM_SIZE
    )
  );

  const out = Buffer.alloc(claims.length);
  let kept = 0;
  for (const i of order) {
    const start = i * XMSS_CLAIM_SIZE;
    if (
      kept > 0 &&
      buffer.compare(out, (kept - 1) * XMSS_CLAIM_SIZE, kept * XMSS_CLAIM_SIZE, start, start + XMSS_CLAIM_SIZE) === 0
    ) {
      continue;
    }
    buffer.copy(out, kept * XMSS_CLAIM_SIZE, start, start + XMSS_CLAIM_SIZE);
    kept++;
  }
  return out.subarray(0, kept * XMSS_CLAIM_SIZE);
}

export class PqVerifier implements IPqVerifier {
  // A signature check is tens of microseconds, so it runs here. A proof check is tens of
  // milliseconds and runs off the JS thread.
  async verifySignatureSets(sets: XmssSignatureSet[]): Promise<boolean> {
    for (const set of sets) {
      if (!verifyXmssSignatureSet(set)) return false;
    }
    return true;
  }

  async verifyProofSets(sets: XmssProofSet[]): Promise<boolean> {
    const results = await Promise.all(sets.map((set) => this.verifyProofSet(set)));
    return results.every(Boolean);
  }

  private async verifyProofSet(set: XmssProofSet): Promise<boolean> {
    const claims = canonicalClaims(set.claims);
    // There is no proof of nothing: a block without attestations carries an empty proof
    if (claims.length === 0) return set.proof.length === 0;
    if (set.proof.length === 0) return false;
    try {
      return await verifyXmssAggregate(set.proof, claims);
    } catch (_e) {
      // Malformed proof bytes or more claims than a proof can hold
      return false;
    }
  }
}
