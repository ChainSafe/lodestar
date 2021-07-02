/**
 * @module chain/stateTransition/util
 */
import {Epoch, Version, Root, DomainType, allForks} from "@chainsafe/lodestar-types";

import {computeForkDataRoot} from "./fork";

// TODO: remove?
/**
 * Return the domain for the [[domainType]] and [[forkVersion]].
 */
export function computeDomain(domainType: DomainType, forkVersion: Version, genesisValidatorRoot: Root): Buffer {
  const forkDataRoot = computeForkDataRoot(forkVersion, genesisValidatorRoot);
  return Buffer.concat([domainType as Buffer, forkDataRoot.slice(0, 28)]);
}

/**
 * Return the ForkVersion at an epoch from a Fork type
 */
export function getForkVersion(fork: allForks.BeaconState["fork"], epoch: Epoch): Version {
  return epoch < fork.epoch ? fork.previousVersion : fork.currentVersion;
}

// TODO: remove?
/**
 * Return the signature domain (fork version concatenated with domain type) of a message.
 */
export function getDomain(state: allForks.BeaconState, domainType: DomainType, messageEpoch: Epoch): Buffer {
  const forkVersion = getForkVersion(state.fork, messageEpoch);
  return computeDomain(domainType, forkVersion, state.genesisValidatorsRoot);
}
