import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {AttestationData, BeaconState, Domain, Epoch, number64, Slot, Version} from "@chainsafe/eth2.0-types";
import {intDiv, intToBytes} from "@chainsafe/eth2.0-utils";
import {equals} from "@chainsafe/ssz";

// Domain Types
export enum DomainType {
  BEACON_PROPOSER = 0,
  BEACON_ATTESTER = 1,
  RANDAO = 2,
  DEPOSIT = 3,
  VOLUNTARY_EXIT = 4,
}

export function getCurrentSlot(config: IBeaconConfig, genesisTime: number64): Slot {
  const diffInSeconds = (Date.now() / 1000) - genesisTime;
  return intDiv(diffInSeconds, config.params.SECONDS_PER_SLOT);
}

/**
 * Return the starting slot of the given epoch.
 */
export function computeStartSlotAtEpoch(config: IBeaconConfig, epoch: Epoch): Slot {
  return epoch * config.params.SLOTS_PER_EPOCH;
}

/**Psrc/
 * Return the epoch number of the given slot.
 */
export function computeEpochAtSlot(config: IBeaconConfig, slot: Slot): Epoch {
  return Math.floor(slot / config.params.SLOTS_PER_EPOCH);
}

/**
 * Return the current epoch of the given state.
 */
export function getCurrentEpoch(config: IBeaconConfig, state: BeaconState): Epoch {
  return computeEpochAtSlot(config, state.slot);
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

/**
 * Check if [[data1]] and [[data2]] are slashable according to Casper FFG rules.
 */
export function isSlashableAttestationData(
  config: IBeaconConfig,
  data1: AttestationData,
  data2: AttestationData
): boolean {
  return (
  // Double vote
    (!equals(data1, data2, config.types.AttestationData)
          && data1.target.epoch === data2.target.epoch) ||
      // Surround vote
      (data1.source.epoch < data2.source.epoch &&
          data2.target.epoch < data1.target.epoch)
  );
}