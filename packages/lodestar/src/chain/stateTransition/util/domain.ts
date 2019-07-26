/**
 * @module chain/stateTransition/util
 */

import {BLSDomain} from "@chainsafe/bls-js/lib/types";

import {
  Epoch,
  Version,
  BeaconState,
} from "../../../types";
import {DomainType} from "../../../constants";
import {IBeaconConfig} from "../../../config";

import {bytesToBN, intToBytes} from "../../../util/bytes";

import {getCurrentEpoch} from "./epoch";

/**
 * Return the domain for the [[domainType]] and [[forkVersion]].
 */
export function computeDomain(domainType: DomainType, forkVersion: Version = Buffer.alloc(4)): BLSDomain {
  return bytesToBN(Buffer.concat([
    intToBytes(domainType, 4),
    forkVersion,
  ])).toBuffer('be', 8);
}

/**
 * Return the signature domain (fork version concatenated with domain type) of a message.
 */
export function getDomain(
  config: IBeaconConfig,
  state: BeaconState,
  domainType: DomainType,
  messageEpoch: Epoch | null = null
): BLSDomain {
  const epoch = messageEpoch || getCurrentEpoch(config, state);
  const forkVersion = epoch < state.fork.epoch
    ? state.fork.previousVersion
    : state.fork.currentVersion;
  return computeDomain(domainType, forkVersion);
}
