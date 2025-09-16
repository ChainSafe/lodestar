import {ChainConfig} from "@lodestar/config";
import {BASIS_POINTS, GENESIS_SLOT} from "@lodestar/params";
import {Epoch, Slot, TimeSeconds} from "@lodestar/types";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "./epoch.js";

export function getSlotsSinceGenesis(config: ChainConfig, genesisTime: TimeSeconds): Slot {
  const diffInSeconds = Date.now() / 1000 - genesisTime;
  return Math.floor(diffInSeconds / config.SECONDS_PER_SLOT);
}

export function getCurrentSlot(config: ChainConfig, genesisTime: TimeSeconds): Slot {
  return GENESIS_SLOT + getSlotsSinceGenesis(config, genesisTime);
}

export function computeSlotsSinceEpochStart(slot: Slot, epoch?: Epoch): Slot {
  const computeEpoch = epoch ?? computeEpochAtSlot(slot);
  return slot - computeStartSlotAtEpoch(computeEpoch);
}

export function computeTimeAtSlot(config: ChainConfig, slot: Slot, genesisTime: TimeSeconds): TimeSeconds {
  return genesisTime + slot * config.SECONDS_PER_SLOT;
}

export function getAttestationDueMs(config: ChainConfig): number {
  return getSlotComponentDurationMs(config, config.ATTESTATION_DUE_BPS);
}

export function getAggregateDueMs(config: ChainConfig): number {
  return getSlotComponentDurationMs(config, config.AGGREGATE_DUE_BPS);
}

export function getSyncMessageDueMs(config: ChainConfig): number {
  return getSlotComponentDurationMs(config, config.SYNC_MESSAGE_DUE_BPS);
}

export function getSyncContributionDueMs(config: ChainConfig): number {
  return getSlotComponentDurationMs(config, config.CONTRIBUTION_DUE_BPS);
}

export function getProposerReorgCutoffMs(config: ChainConfig): number {
  return getSlotComponentDurationMs(config, config.PROPOSER_REORG_CUTOFF_BPS);
}

// Convert basis points to milliseconds into the slot
function getSlotComponentDurationMs(config: ChainConfig, basisPoints: number): number {
  return Math.floor((basisPoints * config.SLOT_DURATION_MS) / BASIS_POINTS);
}
