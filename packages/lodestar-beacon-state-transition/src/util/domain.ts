/**
 * @module chain/stateTransition/util
 */
import {Epoch, Version, Root, DomainType, allForks} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {ZERO_HASH} from "../constants";

import {getCurrentEpoch} from "./epoch";
import {computeForkDataRoot} from "./fork";

/**
 * Return the domain for the [[domainType]] and [[forkVersion]].
 */
export function computeDomain(
  config: IBeaconConfig,
  domainType: DomainType,
  forkVersion?: Version,
  genesisValidatorRoot: Root = ZERO_HASH
): Buffer {
  if (!forkVersion) {
    forkVersion = config.params.GENESIS_FORK_VERSION;
  }
  const forkDataRoot = computeForkDataRoot(config, forkVersion, genesisValidatorRoot);
  return Buffer.concat([domainType as Buffer, (forkDataRoot.valueOf() as Uint8Array).slice(0, 28)]);
}

/**
 * Return the signature domain (fork version concatenated with domain type) of a message.
 */
export function getDomain(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  domainType: DomainType,
  messageEpoch: Epoch | null = null
): Buffer {
  const epoch = messageEpoch || getCurrentEpoch(config, state);
  const forkVersion = epoch < state.fork.epoch ? state.fork.previousVersion : state.fork.currentVersion;
  return computeDomain(config, domainType, forkVersion, state.genesisValidatorsRoot);
}
