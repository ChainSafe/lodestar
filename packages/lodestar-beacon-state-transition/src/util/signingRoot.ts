import {Domain, SigningData} from "@chainsafe/lodestar-types";
import {Type} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

/**
 * Return the signing root of an object by calculating the root of the object-domain tree.
 * @param config
 * @param type
 * @param sszObject
 * @param domain
 */
export function computeSigningRoot<T>(config: IBeaconConfig, type: Type<T>, sszObject: T, domain: Domain): Uint8Array {
  const domainWrappedObject: SigningData = {
    objectRoot: type.hashTreeRoot(sszObject),
    domain,
  };
  return config.types.SigningData.hashTreeRoot(domainWrappedObject);
}