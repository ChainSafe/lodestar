import {Domain, phase0} from "@chainsafe/lodestar-types";
import {Type} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

/**
 * Return the signing root of an object by calculating the root of the object-domain tree.
 */
export function computeSigningRoot<T>(config: IBeaconConfig, type: Type<T>, sszObject: T, domain: Domain): Uint8Array {
  const domainWrappedObject: phase0.SigningData = {
    objectRoot: type.hashTreeRoot(sszObject),
    domain,
  };
  return config.types.phase0.SigningData.hashTreeRoot(domainWrappedObject);
}
