import {ChainConfig, ChainForkConfig} from "@lodestar/config";
import {GENESIS_EPOCH, GENESIS_SLOT} from "@lodestar/params";
import {Epoch, Slot, TimeSeconds} from "@lodestar/types";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "./epoch.js";

/**
 * Slot durations with their activation epochs, derived from the configuration.
 * A fork that changes the slot duration must add an entry here and in `ForkConfig.getSlotDurationMs`.
 */
export function getSlotDurations(config: ChainConfig): [Epoch, number][] {
  const durations: [Epoch, number][] = [[GENESIS_EPOCH, config.SLOT_DURATION_MS]];
  if (config.HEZE_FORK_EPOCH !== Infinity) {
    durations.push([config.HEZE_FORK_EPOCH, config.SLOT_DURATION_MS_HEZE]);
  }
  return durations;
}

/** Slot duration in ms in effect at a given epoch */
export function getSlotDurationMsAtEpoch(config: ChainConfig, epoch: Epoch): number {
  let slotDurationMs = config.SLOT_DURATION_MS;
  for (const [forkEpoch, forkSlotDurationMs] of getSlotDurations(config)) {
    if (epoch >= forkEpoch) {
      slotDurationMs = forkSlotDurationMs;
    }
  }
  return slotDurationMs;
}

/** Slot duration in ms for a given slot */
export function getSlotDurationMs(config: ChainForkConfig, slot: Slot): number {
  return config.getSlotDurationMs(config.getForkName(slot));
}

export function computeTimeAtSlotMs(config: ChainConfig, slot: Slot, genesisTimeMs: number): number {
  let endSlot = slot;
  let timeMs = genesisTimeMs;
  for (const [forkEpoch, slotDurationMs] of getSlotDurations(config).reverse()) {
    const forkSlot = computeStartSlotAtEpoch(forkEpoch);
    if (forkSlot < endSlot) {
      timeMs += (endSlot - forkSlot) * slotDurationMs;
      endSlot = forkSlot;
    }
  }
  // Pre-genesis slots extrapolate linearly so the clock keeps ticking before genesis
  return timeMs + (endSlot - GENESIS_SLOT) * getSlotDurationMsAtEpoch(config, GENESIS_EPOCH);
}

export function computeTimeAtSlot(config: ChainConfig, slot: Slot, genesisTime: TimeSeconds): TimeSeconds {
  return computeTimeAtSlotMs(config, slot, genesisTime * 1000) / 1000;
}

export function computeSlotAtTimeMs(config: ChainConfig, timeMs: number, genesisTimeMs: number): Slot {
  let startSlot = GENESIS_SLOT;
  let startTimeMs = genesisTimeMs;
  let slotDurationMs = getSlotDurationMsAtEpoch(config, GENESIS_EPOCH);
  for (const [forkEpoch, forkSlotDurationMs] of getSlotDurations(config)) {
    const forkSlot = computeStartSlotAtEpoch(forkEpoch);
    const forkTimeMs = computeTimeAtSlotMs(config, forkSlot, genesisTimeMs);
    if (timeMs >= forkTimeMs) {
      startSlot = forkSlot;
      startTimeMs = forkTimeMs;
      slotDurationMs = forkSlotDurationMs;
    }
  }
  return startSlot + Math.floor((timeMs - startTimeMs) / slotDurationMs);
}

export function getSlotsSinceGenesis(config: ChainConfig, genesisTime: TimeSeconds): Slot {
  return computeSlotAtTimeMs(config, Date.now(), genesisTime * 1000) - GENESIS_SLOT;
}

export function getCurrentSlot(config: ChainConfig, genesisTime: TimeSeconds): Slot {
  return GENESIS_SLOT + getSlotsSinceGenesis(config, genesisTime);
}

/**
 * Start epoch of the blob data retention window, preserving its wall-clock length
 * across slot duration changes
 */
export function getBlobDataRetentionStartEpoch(config: ChainConfig, epoch: Epoch): Epoch {
  const windowMs = config.MIN_BLOB_DATA_RETENTION_MS;
  const currentStartMs = computeTimeAtSlotMs(config, computeStartSlotAtEpoch(epoch), 0);
  if (currentStartMs < windowMs) {
    return GENESIS_EPOCH;
  }
  return computeEpochAtSlot(computeSlotAtTimeMs(config, currentStartMs - windowMs, 0));
}

export function computeSlotsSinceEpochStart(slot: Slot, epoch?: Epoch): Slot {
  const computeEpoch = epoch ?? computeEpochAtSlot(slot);
  return slot - computeStartSlotAtEpoch(computeEpoch);
}
