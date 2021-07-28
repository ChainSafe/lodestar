/**
 * @module chain/stateTransition/util
 */
import {Epoch, Version, Root, DomainType, allForks} from "@chainsafe/lodestar-types";

import {computeForkDataRoot} from "./fork";

// Only used by processDeposit +  lightclient
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
