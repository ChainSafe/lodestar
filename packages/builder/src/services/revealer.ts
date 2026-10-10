import {ApiError} from "@lodestar/api";
import type {ChainForkConfig} from "@lodestar/config";
import type {IClock} from "@lodestar/state-transition";
import type {BuilderIndex} from "@lodestar/types";
import {type Logger, TimeoutError, isFetchError, retry, withTimeout} from "@lodestar/utils";
import type {Metrics} from "../metrics.js";
import type {BidLedger} from "./bidLedger.js";
import type {BidSelector} from "./bidSelector.js";
import type {ObservedBlock} from "./blockObserver.js";
import type {EnvelopePublisher} from "./envelopePublisher.js";
import {createExecutionPayloadEnvelopeContents} from "./executionPayloadEnvelope.js";
import type {PayloadStore} from "./payloadStore.js";

export type RevealerOptions = {
  /** Publication cutoff within the selected block's slot, not the earlier build slot. */
  cutoffBps: number;
  /** Optional policy override; otherwise reveal promptly after a matching import. */
  shouldReveal?: (block: ObservedBlock, signal: AbortSignal) => Promise<boolean>;
};

export type RevealerModules = {
  config: ChainForkConfig;
  clock: IClock;
  logger: Logger;
  metrics: Metrics | null;
  builderIndex: BuilderIndex;
  ledger: BidLedger;
  selector: BidSelector;
  publisher: EnvelopePublisher;
  store: PayloadStore;
};

export class Revealer {
  constructor(
    private readonly modules: RevealerModules,
    private readonly options: RevealerOptions
  ) {}

  async onBlock(observed: ObservedBlock, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const {config, clock, logger, metrics, builderIndex, selector, publisher, store, ledger} = this.modules;
    const context = {slot: observed.slot, blockRoot: observed.blockRoot};
    const selected = selector.match(observed);
    if (selected.status !== "selected") {
      if (ledger.getBidsForSlot(observed.slot).length > 0) {
        const bid = observed.block.message.body.signedExecutionPayloadBid.message;
        logger.info("Bid from another builder selected", {
          ...context,
          builderIndex: bid.builderIndex,
          value: bid.value,
        });
        metrics?.bidSelections.inc({result: "lost"});
      }
      return;
    }
    metrics?.bidSelections.inc({result: "won"});
    logger.info("Local bid selected", {...context, value: selected.bid.valueGwei});

    const cutoff = config.getSlotComponentDurationMs(this.options.cutoffBps);
    const remaining = cutoff - clock.msFromSlot(observed.slot);
    if (remaining <= 0) {
      metrics?.reveals.inc({result: "cutoff"});
      logger.warn("Selected block arrived after reveal cutoff", {...context, code: "BUILDER_REVEAL_CUTOFF"});
      return;
    }
    try {
      await withTimeout(
        async (timeoutSignal) => {
          const publicationSignal = timeoutSignal ?? signal;
          if (this.options.shouldReveal) {
            const shouldReveal = await this.options.shouldReveal(observed, publicationSignal);
            publicationSignal.throwIfAborted();
            if (!shouldReveal) {
              metrics?.reveals.inc({result: "withheld"});
              logger.debug("Reveal declined by policy", context);
              return;
            }
          }
          publicationSignal.throwIfAborted();
          if (clock.msFromSlot(observed.slot) >= cutoff) throw new TimeoutError("Reveal cutoff reached");
          const storedPayload = store.get(selected.bid.blockHash);
          if (storedPayload === null) {
            metrics?.reveals.inc({result: "expired"});
            logger.warn("Selected payload expired before reveal", {...context, code: "BUILDER_REVEAL_PAYLOAD_EXPIRED"});
            return;
          }
          const contents = createExecutionPayloadEnvelopeContents({
            blockRoot: selected.blockRoot,
            builderIndex,
            selectedBid: observed.block.message.body.signedExecutionPayloadBid.message,
            storedPayload,
          });
          const result = await retry(
            () => {
              publicationSignal.throwIfAborted();
              if (clock.msFromSlot(observed.slot) >= cutoff) throw new TimeoutError("Reveal cutoff reached");
              return publisher.publish(contents, publicationSignal);
            },
            {
              retries: 2,
              retryDelay: 100,
              signal: publicationSignal,
              shouldRetry: (error) => {
                if (publicationSignal.aborted || clock.msFromSlot(observed.slot) >= cutoff) return false;
                if (error instanceof ApiError)
                  return error.status === 429 || (error.status >= 500 && error.status < 600);
                return (
                  error instanceof TimeoutError ||
                  (isFetchError(error) && (error.type === "failed" || error.type === "timeout"))
                );
              },
              onRetry: (error, attempt) =>
                logger.debug("Retrying payload envelope publication", {...context, attempt}, error),
            }
          );
          metrics?.reveals.inc({result: result.status});
          if (result.status === "published") logger.info("Published payload envelope", context);
        },
        remaining,
        signal
      );
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof TimeoutError && clock.msFromSlot(observed.slot) >= cutoff) {
        metrics?.reveals.inc({result: "cutoff"});
        logger.warn("Payload envelope publication reached reveal cutoff", {...context, code: "BUILDER_REVEAL_CUTOFF"});
        return;
      }
      metrics?.reveals.inc({result: "failed"});
      throw error;
    }
  }
}
