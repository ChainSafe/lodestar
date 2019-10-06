import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {Epoch, Slot} from "@chainsafe/eth2.0-types";
import {intToBytes} from "@chainsafe/eth2.0-utils";

/**
 * Return the starting slot of the given epoch.
 */
export function computeStartSlotOfEpoch(config: IBeaconConfig, epoch: Epoch): Slot {
  return epoch * config.params.SLOTS_PER_EPOCH;
}

/**
 * Return the epoch number of the given slot.
 */
export function computeEpochOfSlot(config: IBeaconConfig, slot: Slot): Epoch {
  return Math.floor(slot / config.params.SLOTS_PER_EPOCH);
}

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