import {ApiError} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {IClock} from "@lodestar/state-transition";
import {BuilderIndex} from "@lodestar/types";
import {Logger, TimeoutError, isFetchError, retry, withTimeout} from "@lodestar/utils";
import {Metrics, RevealResult} from "../metrics.js";
import {BidSelector} from "./bidSelector.js";
import {ObservedBlock} from "./blockObserver.js";
import {EnvelopePublisher} from "./envelopePublisher.js";
import {createExecutionPayloadEnvelopeContents} from "./executionPayloadEnvelope.js";
import {PayloadStore} from "./payloadStore.js";

export type RevealerOptions = {
  /** Do not reveal after this point within the block's slot, in basis points */
  cutoffBps: number;
};

export type RevealerModules = {
  config: ChainForkConfig;
  logger: Logger;
  clock: IClock;
  bidSelector: BidSelector;
  payloadStore: PayloadStore;
  envelopePublisher: EnvelopePublisher;
  builderIndex: BuilderIndex;
  metrics: Metrics | null;
  signal: AbortSignal;
};

/** Reveals the payload once a block committing to one of our bids is imported by the beacon node. */
export class Revealer {
  constructor(
    private readonly modules: RevealerModules,
    private readonly opts: RevealerOptions
  ) {}

  async onBlock(observed: ObservedBlock): Promise<void> {
    const {bidSelector, clock, config, envelopePublisher, logger, metrics, payloadStore} = this.modules;
    const selection = bidSelector.match(observed);
    if (selection.status !== "selected") {
      return;
    }
    metrics?.bids.won.inc();

    const {blockRoot, slot} = observed;
    const {blockHash} = selection.bid;
    const logCtx = {slot, blockRoot, blockHash};

    const storedPayload = payloadStore.get(blockHash);
    if (storedPayload === null) {
      logger.error("Payload of selected bid is not retained, cannot reveal", logCtx);
      metrics?.reveals.total.inc({result: RevealResult.unknownPayload});
      return;
    }

    const msFromSlot = clock.msFromSlot(slot);
    const cutoffMs = config.getSlotComponentDurationMs(config.getForkName(slot), this.opts.cutoffBps);
    if (msFromSlot >= cutoffMs) {
      logger.warn("Block with our bid arrived after reveal cutoff, not revealing", {...logCtx, msFromSlot, cutoffMs});
      metrics?.reveals.total.inc({result: RevealResult.late});
      return;
    }

    const contents = createExecutionPayloadEnvelopeContents({
      blockRoot,
      builderIndex: this.modules.builderIndex,
      selectedBid: observed.signedBid.message,
      storedPayload,
    });

    try {
      await withTimeout(
        (signal = this.modules.signal) =>
          retry(
            () => {
              signal.throwIfAborted();
              if (clock.msFromSlot(slot) >= cutoffMs) throw new TimeoutError("Reveal cutoff reached");
              return envelopePublisher.publish(contents, signal);
            },
            {
              retries: 2,
              retryDelay: 100,
              signal,
              shouldRetry: (error) => {
                if (signal.aborted || clock.msFromSlot(slot) >= cutoffMs) return false;
                if (error instanceof ApiError)
                  return error.status === 429 || (error.status >= 500 && error.status < 600);
                return (
                  error instanceof TimeoutError ||
                  (isFetchError(error) && (error.type === "failed" || error.type === "timeout"))
                );
              },
            }
          ),
        cutoffMs - msFromSlot,
        this.modules.signal
      );
    } catch (e) {
      if (this.modules.signal.aborted) throw e;
      if (e instanceof TimeoutError && clock.msFromSlot(slot) >= cutoffMs) {
        metrics?.reveals.total.inc({result: RevealResult.late});
        logger.warn("Payload publication reached reveal cutoff", {...logCtx, cutoffMs});
        return;
      }
      metrics?.reveals.total.inc({result: RevealResult.error});
      throw e;
    }

    metrics?.reveals.total.inc({result: RevealResult.published});
    logger.info("Revealed execution payload", {
      ...logCtx,
      blobs: contents.blobs.length,
      transactions: contents.envelope.payload.transactions.length,
      secFromSlot: clock.secFromSlot(slot),
    });
  }
}
