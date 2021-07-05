import {Domain, phase0, ssz} from "@chainsafe/lodestar-types";
import {Type} from "@chainsafe/ssz";

/**
 * Return the signing root of an object by calculating the root of the object-domain tree.
 */
export function computeSigningRoot<T>(type: Type<T>, sszObject: T, domain: Domain): Uint8Array {
  const domainWrappedObject: phase0.SigningData = {
    objectRoot: type.hashTreeRoot(sszObject),
    domain,
  };
  return ssz.phase0.SigningData.hashTreeRoot(domainWrappedObject);
}
