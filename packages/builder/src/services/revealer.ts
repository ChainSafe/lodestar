import {ApiError} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD} from "@lodestar/params";
import {IClock} from "@lodestar/state-transition";
import {BuilderIndex} from "@lodestar/types";
import {Logger, TimeoutError, isFetchError, prettyGweiToEth, retry, toRootHex} from "@lodestar/utils";
import {Metrics, RevealResult} from "../metrics.js";
import {BidLedger} from "./bidLedger.js";
import {BidSelector} from "./bidSelector.js";
import {ObservedBlock} from "./blockObserver.js";
import {EnvelopePublisher} from "./envelopePublisher.js";
import {createExecutionPayloadEnvelopeContents} from "./executionPayloadEnvelope.js";
import {PayloadStore} from "./payloadStore.js";

/** Time in milliseconds to wait before publishing the envelope again after a transient failure */
const REVEAL_RETRY_DELAY = 200;

/**
 * Maximum time in milliseconds a single publish request may take. The default request timeout of the api client
 * exceeds the reveal window, the cap leaves time to publish again if the beacon node does not respond.
 * Does not apply to the last request that can be sent before the cutoff, a slow request is not cut short.
 */
const REVEAL_ATTEMPT_TIMEOUT = 1000;

export type RevealerOptions = {
  /**
   * Latest point within the block's slot at which a reveal may start, in basis points.
   * Defaults to the network's PAYLOAD_ATTESTATION_DUE_BPS
   */
  cutoffBps: number;
  /** Timeout in milliseconds of requests to the beacon node, a reveal attempt is not given more time than that */
  requestTimeout?: number;
};

export type RevealerModules = {
  config: ChainForkConfig;
  logger: Logger;
  clock: IClock;
  bidSelector: BidSelector;
  ledger: BidLedger;
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
    const {bidSelector, clock, config, envelopePublisher, ledger, logger, metrics, payloadStore} = this.modules;
    const {blockRoot, slot} = observed;
    const selection = bidSelector.match(observed);
    if (selection.status !== "selected") {
      const {builderIndex, value, parentBlockHash, parentBlockRoot} = observed.signedBid.message;
      // Our bid for the parent the block is built on, bids for other parents of the slot could not be selected
      const ownBid = ledger.getSignedBid(slot, toRootHex(parentBlockHash), toRootHex(parentBlockRoot));
      if (ownBid !== null) {
        logger.info("Execution payload bid not selected", {
          slot,
          builderIndex: this.modules.builderIndex,
          blockRoot,
          value: prettyGweiToEth(ownBid.message.value),
          selectedBuilderIndex: builderIndex === BUILDER_INDEX_SELF_BUILD ? "self-build" : builderIndex,
          selectedValue: prettyGweiToEth(value),
        });
      }
      return;
    }
    metrics?.bids.won.inc();

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
    if (msFromSlot > cutoffMs) {
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
      // The block is only observed once, a transient failure has to be retried here while a reveal may still start.
      // Publishing the same envelope again is safe, the beacon node treats an already known envelope as published
      const attemptTimeout = Math.min(this.opts.requestTimeout ?? REVEAL_ATTEMPT_TIMEOUT, REVEAL_ATTEMPT_TIMEOUT);
      // No other request can be sent once this one timed out, use the request timeout of the api client
      const isLastAttempt = (): boolean => clock.msFromSlot(slot) + attemptTimeout + REVEAL_RETRY_DELAY > cutoffMs;
      const publish = (): ReturnType<EnvelopePublisher["publish"]> =>
        envelopePublisher.publish(contents, this.modules.signal, isLastAttempt() ? undefined : attemptTimeout);
      await retry(publish, {
        retries: Infinity,
        retryDelay: REVEAL_RETRY_DELAY,
        signal: this.modules.signal,
        shouldRetry: (error) =>
          isRetryableRevealError(error) && clock.msFromSlot(slot) + REVEAL_RETRY_DELAY <= cutoffMs,
        onRetry: (error, attempt) => {
          logger.debug("Retrying execution payload reveal", {
            ...logCtx,
            attempt,
            msFromSlot: clock.msFromSlot(slot),
            error: error.message,
          });
        },
      });
    } catch (e) {
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

/**
 * Failures that can resolve on their own while the reveal window is open, e.g. the beacon node being briefly
 * unreachable or overloaded
 */
export function isRetryableRevealError(error: Error): boolean {
  if (error instanceof ApiError) {
    return error.status >= 500;
  }

  return error instanceof TimeoutError || (isFetchError(error) && error.type !== "input");
}
