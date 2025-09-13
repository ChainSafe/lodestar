import {IndexedAttestation, IndexedAttestationBigint} from "@lodestar/types";
import {ApiError} from "./errors.js";

/**
 * Ensures that the array contains unique values, and throws an ApiError
 * otherwise.
 * @param array - The array to check for uniqueness.
 * @param message - The message to put in the ApiError if the array contains
 * duplicates.
 */
export function assertUniqueItems(array: unknown[] | undefined, message: string): void {
  if (!array) {
    return;
  }

  const duplicateItems = array.reduce((partialDuplicateItems: unknown[], item, index) => {
    if (array.indexOf(item) !== index && !partialDuplicateItems.includes(item)) {
      return partialDuplicateItems.concat(item);
    }
    return partialDuplicateItems;
  }, []);

  if (duplicateItems.length) {
    throw new ApiError(400, `${message}: ${duplicateItems.join(", ")}`);
  }
}

export function toIndexedAttestationBigint(indexedAttestation: IndexedAttestation): IndexedAttestationBigint {
  return {
    attestingIndices: indexedAttestation.attestingIndices,
    data: {
      slot: BigInt(indexedAttestation.data.slot),
      index: BigInt(indexedAttestation.data.index),
      beaconBlockRoot: indexedAttestation.data.beaconBlockRoot,
      source: {
        epoch: BigInt(indexedAttestation.data.source.epoch),
        root: indexedAttestation.data.source.root,
      },
      target: {
        epoch: BigInt(indexedAttestation.data.target.epoch),
        root: indexedAttestation.data.target.root,
      },
    },
    signature: indexedAttestation.signature,
  };
}
