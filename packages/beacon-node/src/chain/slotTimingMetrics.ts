import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {Metrics} from "../metrics/index.js";
import {SlotPosition} from "../metrics/metrics/lodestar.js";
import {OpSource} from "./validatorMonitor.js";

export function getSlotDurationSec(config: ChainForkConfig, slot: Slot): number {
  return config.getSlotDurationMs(config.getForkName(slot)) / 1000;
}

export function getSlotPosition(slot: Slot): SlotPosition {
  return (slot + 1) % SLOTS_PER_EPOCH === 0 ? "epoch_end" : "other";
}

/**
 * Seed the slot timing gauge and counters so a scrape before the first observation reports
 * the duration in effect and a zero miss count instead of absent series.
 */
export function initSlotTimingMetrics(metrics: Metrics, config: ChainForkConfig, currentSlot: Slot): void {
  setSlotDurationGauge(metrics, config, currentSlot);
  metrics.slotTiming.deadlineMissed.inc({deadline: "attestation_due", task: "block_become_head"}, 0);
  metrics.slotTiming.deadlineMissed.inc({deadline: "next_slot_start", task: "prepare_next_slot"}, 0);
}

export function setSlotDurationGauge(metrics: Metrics, config: ChainForkConfig, slot: Slot): void {
  metrics.slotTiming.slotDurationSeconds.set(getSlotDurationSec(config, slot));
}

export function observeBlockArrival(
  metrics: Metrics,
  config: ChainForkConfig,
  source: OpSource,
  slot: Slot,
  delaySec: number
): void {
  metrics.gossipBlock.elapsedTimeTillReceived.observe({source}, delaySec);
  metrics.gossipBlock.arrivalSlotFraction.observe({source}, delaySec / getSlotDurationSec(config, slot));
}

/**
 * `delaySec` is measured from the start of `headSlot`. Only recent heads are sampled, otherwise
 * sync distorts the distribution. The cutoff counter shares that population.
 */
export function observeBlockBecomeHead(
  metrics: Metrics,
  config: ChainForkConfig,
  headSlot: Slot,
  delaySec: number
): void {
  const slotDurationSec = getSlotDurationSec(config, headSlot);
  if (delaySec >= SLOTS_PER_EPOCH * slotDurationSec) {
    return;
  }
  metrics.importBlock.elapsedTimeTillBecomeHead.observe(delaySec);
  metrics.importBlock.becomeHeadSlotFraction.observe(delaySec / slotDurationSec);
  if (delaySec > config.getAttestationDueMs(config.getForkName(headSlot)) / 1000) {
    metrics.importBlock.setHeadAfterCutoff.inc();
    metrics.slotTiming.deadlineMissed.inc({deadline: "attestation_due", task: "block_become_head"});
  }
}
