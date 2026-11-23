import {descriptorToBitlist} from "@chainsafe/persistent-merkle-tree";
import {ApiError, ValidationError} from "../errors.js";

// Bound the recursive proof builders independently of descriptor breadth.
const MAX_PROOF_DEPTH = 256;

export function validateProofRequest(id: string, descriptor: Uint8Array, maxDescriptorBytes: number): void {
  if (
    !["head", "genesis", "finalized", "justified"].includes(id) &&
    !/^0x[0-9a-fA-F]{64}$/.test(id) &&
    !(/^\d+$/.test(id) && Number.isSafeInteger(Number(id)))
  ) {
    throw new ValidationError("Invalid proof object identifier");
  }

  if (descriptor.length > maxDescriptorBytes) {
    throw new ApiError(413, `Proof descriptor exceeds the limit of ${maxDescriptorBytes} bytes`);
  }

  let bits: boolean[];
  try {
    bits = descriptorToBitlist(descriptor);
  } catch {
    throw new ValidationError("Invalid proof descriptor: expected a complete tree with minimal zero padding");
  }

  const depths = [0];
  for (const terminal of bits) {
    const depth = depths.pop();
    if (depth === undefined) throw new ValidationError("Invalid proof descriptor");
    if (!terminal) {
      if (depth >= MAX_PROOF_DEPTH) {
        throw new ApiError(413, `Proof exceeds the maximum traversal depth of ${MAX_PROOF_DEPTH}`);
      }
      depths.push(depth + 1, depth + 1);
    }
  }
}
