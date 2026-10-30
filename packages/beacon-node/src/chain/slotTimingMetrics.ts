import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {ExecutionPayloadStatus} from "../execution/engine/interface.js";
import {Metrics} from "../metrics/index.js";
import {ImportedPayloadStatus, SlotPosition} from "../metrics/metrics/lodestar.js";
import {PayloadEnvelopeInputSource} from "./blocks/payloadEnvelopeInput/types.js";
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
  metrics.slotTiming.deadlineMissed.inc({task: "block_become_head"}, 0);
  metrics.slotTiming.deadlineMissed.inc({task: "prepare_next_slot"}, 0);
  metrics.slotTiming.deadlineMissed.inc({task: "prepare_next_slot_completion"}, 0);
  metrics.slotTiming.prepareNextSlotPtcEligibleCompletions.inc(0);
  for (const status of [
    ExecutionPayloadStatus.VALID,
    ExecutionPayloadStatus.SYNCING,
    ExecutionPayloadStatus.ACCEPTED,
  ] as const) {
    metrics.importPayload.deadlineMissed.inc({status}, 0);
  }
  metrics.importPayload.beyondWindow.inc(0);
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
 * `delaySec` is measured from the start of the payload slot. Only payloads of the current or
 * previous clock slot enter the slot fraction and deadline samples: older imports mix catch-up
 * with genuine stalls and are counted separately, future slots are dropped. The deadline
 * counter shares the sampled population.
 */
export function observePayloadImport(
  metrics: Metrics,
  config: ChainForkConfig,
  {
    slot,
    currentSlot,
    delaySec,
    source,
    status,
  }: {
    slot: Slot;
    currentSlot: Slot;
    delaySec: number;
    source: PayloadEnvelopeInputSource;
    status: ImportedPayloadStatus;
  }
): void {
  metrics.importPayload.elapsedTimeTillImported.observe({source}, delaySec);
  if (slot > currentSlot) {
    return;
  }
  if (slot < currentSlot - 1) {
    metrics.importPayload.beyondWindow.inc();
    return;
  }
  const fork = config.getForkName(slot);
  metrics.importPayload.elapsedSlotFraction.observe({status}, delaySec / (config.getSlotDurationMs(fork) / 1000));
  if (delaySec > config.getPayloadDueMs(fork) / 1000) {
    metrics.importPayload.deadlineMissed.inc({status});
  }
}

/**
 * `delaySec` is measured from the start of `headSlot`. Only recent heads are sampled, otherwise
 * sync distorts the distribution. The deadline counter shares that population.
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
    metrics.slotTiming.deadlineMissed.inc({task: "block_become_head"});
  }
}
