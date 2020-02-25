/**
 * @module chain/stateTransition/util
 */
import {
  Epoch,
  Version,
  BeaconState,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {DomainType} from "../constants";
import {intToBytes} from "@chainsafe/lodestar-utils";

import {getCurrentEpoch} from "./epoch";

/**
 * Return the domain for the [[domainType]] and [[forkVersion]].
 */
export function computeDomain(domainType: DomainType, forkVersion: Version = Buffer.alloc(4)): Buffer {
  return Buffer.concat([
    intToBytes(domainType, 4),
    forkVersion.valueOf() as Uint8Array,
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
): Buffer {
  const epoch = messageEpoch || getCurrentEpoch(config, state);
  const forkVersion = epoch < state.fork.epoch
    ? state.fork.previousVersion
    : state.fork.currentVersion;
  return computeDomain(domainType, forkVersion);
}
