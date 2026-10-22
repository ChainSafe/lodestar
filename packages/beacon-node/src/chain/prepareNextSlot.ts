import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {Logger, isErrorAborted, sleep} from "@lodestar/utils";
import {GENESIS_SLOT} from "../constants/constants.js";
import {Metrics} from "../metrics/index.js";
import {ClockEvent} from "../util/clock.js";
import {isQueueErrorAborted} from "../util/queue/index.js";
import {BeaconEngineErrorCode} from "./beaconEngine/interface.js";
import {IBeaconChain} from "./interface.js";

// TODO GLOAS: re-evaluate this timing
/* With 12s slot times, this scheduler will run 4s before the start of each slot (`12 - 0.6667 * 12 = 4`). */
export const PREPARE_NEXT_SLOT_BPS = 6667;

/**
 * At Bellatrix, if we are responsible for proposing in next slot, we want to prepare payload
 * 4s before the start of next slot at PREPARE_NEXT_SLOT_BPS of the current slot.
 *
 * For all forks, when clock reaches PREPARE_NEXT_SLOT_BPS of slot before an epoch, we want to prepare for the next epoch
 * transition from our head so that:
 * + validators vote for block head on time through attestation
 * + validators propose blocks on time
 * + For Bellatrix, to compute proposers of next epoch so that we can prepare new payloads
 *
 * The consensus work is owned by `BeaconEngine.prepareForNextSlot`; this scheduler owns the clock
 * listener, sleep timing, error reporting, payload attributes events, and DA seen-cache pruning.
 */
export class PrepareNextSlotScheduler {
  constructor(
    private readonly chain: IBeaconChain,
    private readonly config: ChainForkConfig,
    private readonly metrics: Metrics | null,
    private readonly logger: Logger,
    private readonly signal: AbortSignal
  ) {
    this.chain.clock.on(ClockEvent.slot, this.prepareForNextSlot);
    this.signal.addEventListener(
      "abort",
      () => {
        this.chain.clock.off(ClockEvent.slot, this.prepareForNextSlot);
      },
      {once: true}
    );
  }

  /**
   * Use clockSlot instead of clockEpoch to schedule the task at more exact time.
   */
  prepareForNextSlot = async (clockSlot: Slot): Promise<void> => {
    const prepareSlot = clockSlot + 1;
    const prepareEpoch = computeEpochAtSlot(prepareSlot);
    const nextEpoch = computeEpochAtSlot(clockSlot) + 1;
    const isEpochTransition = prepareEpoch === nextEpoch;
    const fork = this.config.getForkName(prepareSlot);
    const currentFork = this.config.getForkName(clockSlot);

    // Early return if we are pre-genesis
    //  or we are pre-bellatrix and this is not an epoch transition
    if (prepareSlot <= GENESIS_SLOT || (ForkSeq[fork] < ForkSeq.bellatrix && !isEpochTransition)) {
      return;
    }

    try {
      // At PREPARE_NEXT_SLOT_BPS (~67%) of the current slot we prepare payload for the next slot
      // or precompute epoch transition
      await sleep(this.config.getSlotComponentDurationMs(currentFork, PREPARE_NEXT_SLOT_BPS), this.signal);

      // [beacon-engine] moved: consensus/EL preparation and computeStateHashTreeRoot now live in
      // packages/beacon-node/src/chain/beaconEngine/prepareNextSlot.ts under the same names.
      // On unstable merges, sync that logic there; retain scheduling, SSE emission and error logging here.
      const result = await this.chain.beaconEngine.prepareForNextSlot(
        clockSlot,
        {
          produceSSEPayloadAttributes: this.chain.emitter.listenerCount(routes.events.EventType.payloadAttributes) > 0,
        },
        this.chain.getHead()
      );
      if (!result.ok) {
        if (result.code !== BeaconEngineErrorCode.ABORTED) {
          this.metrics?.precomputeNextEpochTransition.count.inc({result: "error"}, 1);
          this.logger.error(
            "Failed to run prepareForNextSlot",
            {nextEpoch, isEpochTransition, prepareSlot},
            new Error(result.payload.message)
          );
        }
        return;
      }
      if (result.data?.payloadAttributes) {
        this.chain.emitter.emit(routes.events.EventType.payloadAttributes, result.data.payloadAttributes);
      }
      if (result.data?.daPruneParent) {
        this.chain.seenPayloadEnvelopeInputCache.pruneBelowParent(result.data.daPruneParent);
      }
    } catch (e) {
      if (!isErrorAborted(e) && !isQueueErrorAborted(e)) {
        this.metrics?.precomputeNextEpochTransition.count.inc({result: "error"}, 1);
        this.logger.error("Failed to run prepareForNextSlot", {nextEpoch, isEpochTransition, prepareSlot}, e as Error);
      }
    }
  };
}
