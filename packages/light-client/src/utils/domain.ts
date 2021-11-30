// Only used by processDeposit +  lightclient

import {Epoch, Version, Root, DomainType, allForks, phase0, ssz, Domain} from "@chainsafe/lodestar-types";
import {Type} from "@chainsafe/ssz";

/**
 * Return the domain for the [[domainType]] and [[forkVersion]].
 */
export function computeDomain(domainType: DomainType, forkVersion: Version, genesisValidatorRoot: Root): Uint8Array {
  const forkDataRoot = computeForkDataRoot(forkVersion, genesisValidatorRoot);
  const domain = new Uint8Array(32);
  domain.set(domainType, 0);
  domain.set(forkDataRoot.slice(0, 28), 4);
  return domain;
}

/**
 * Return the ForkVersion at an epoch from a Fork type
 */
export function getForkVersion(fork: allForks.BeaconState["fork"], epoch: Epoch): Version {
  return epoch < fork.epoch ? fork.previousVersion : fork.currentVersion;
}

/**
 * Used primarily in signature domains to avoid collisions across forks/chains.
 */
export function computeForkDataRoot(currentVersion: Version, genesisValidatorsRoot: Root): Uint8Array {
  const forkData: phase0.ForkData = {
    currentVersion,
    genesisValidatorsRoot,
  };
  return ssz.phase0.ForkData.hashTreeRoot(forkData);
}

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
