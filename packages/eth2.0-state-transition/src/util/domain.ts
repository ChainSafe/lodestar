/**
 * @module chain/stateTransition/util
 */
import {
  Epoch,
  Version,
  BeaconState, Domain,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {DomainType} from "../constants";
import {intToBytes} from "@chainsafe/eth2.0-utils";

import {getCurrentEpoch} from "./epoch";

/**
 * Return the domain for the [[domainType]] and [[forkVersion]].
 */
export function computeDomain(domainType: DomainType, forkVersion: Version = Buffer.alloc(4)): Domain {
  return Buffer.concat([
    intToBytes(domainType, 4),
    forkVersion,
  ]);
}

/**
 * Return the signature domain (fork version concatenated with domain type) of a message.
 */
export function getDomain(
  config: IBeaconConfig,
  state: BeaconState,
  domainType: DomainType,
  messageEpoch: Epoch | null = null
): Domain {
  const epoch = messageEpoch || getCurrentEpoch(config, state);
  const forkVersion = epoch < state.fork.epoch
    ? state.fork.previousVersion
    : state.fork.currentVersion;
  return computeDomain(domainType, forkVersion);
}
