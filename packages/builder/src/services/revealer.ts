import {ChainForkConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD} from "@lodestar/params";
import {IClock} from "@lodestar/state-transition";
import {BuilderIndex} from "@lodestar/types";
import {Logger, prettyGweiToEth, sleep} from "@lodestar/utils";
import {defaultOptions} from "../defaults.js";
import {Metrics, RevealResult} from "../metrics.js";
import {BidLedger} from "./bidLedger.js";
import {BidSelector} from "./bidSelector.js";
import {ObservedBlock} from "./blockObserver.js";
import {EnvelopePublisher} from "./envelopePublisher.js";
import {createExecutionPayloadEnvelopeContents} from "./executionPayloadEnvelope.js";
import {PayloadStore} from "./payloadStore.js";

export type RevealerOptions = {
  /** Do not reveal after this point within the block's slot, in basis points */
  cutoffBps: number;
  /** Devnet test only, never reveal the payload of a selected bid */
  adversarialWithholdExecutionPayload?: boolean;
  /** Devnet test only, hold the reveal until adversarialDelayExecutionPayloadBps within the block's slot */
  adversarialDelayExecutionPayload?: boolean;
  adversarialDelayExecutionPayloadBps?: number;
};

export type RevealerModules = {
  config: ChainForkConfig;
  logger: Logger;
  clock: IClock;
  ledger: BidLedger;
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
    const {bidSelector, clock, config, envelopePublisher, ledger, logger, metrics, payloadStore} = this.modules;
    const {blockRoot, slot} = observed;
    const selection = bidSelector.match(observed);
    if (selection.status !== "selected") {
      const bids = ledger.getBidsForSlot(slot);
      if (bids.length > 0) {
        const {builderIndex, value} = observed.signedBid.message;
        logger.info("Execution payload bid not selected", {
          slot,
          builderIndex: this.modules.builderIndex,
          blockRoot,
          value: prettyGweiToEth(Math.max(...bids.map((bid) => bid.valueGwei))),
          selectedBuilderIndex: builderIndex === BUILDER_INDEX_SELF_BUILD ? "self-build" : builderIndex,
          selectedValue: prettyGweiToEth(value),
        });
      }
      return;
    }
    metrics?.bids.won.inc();

    const {blockHash} = selection.bid;
    const logCtx = {slot, blockRoot, blockHash, builderIndex: this.modules.builderIndex};
    logger.info("Execution payload bid selected", {...logCtx, value: prettyGweiToEth(selection.bid.valueGwei)});

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

    if (this.opts.adversarialWithholdExecutionPayload) {
      logger.warn("ADVERSARIAL: Withholding execution payload", logCtx);
      metrics?.reveals.total.inc({result: RevealResult.withheld});
      return;
    }

    const contents = createExecutionPayloadEnvelopeContents({
      blockRoot,
      builderIndex: this.modules.builderIndex,
      selectedBid: observed.signedBid.message,
      storedPayload,
    });

    if (this.opts.adversarialDelayExecutionPayload) {
      const delayBps =
        this.opts.adversarialDelayExecutionPayloadBps ?? defaultOptions.reveal.adversarialDelayExecutionPayloadBps;
      const delayMs = Math.max(config.getSlotComponentDurationMs(config.getForkName(slot), delayBps) - msFromSlot, 0);
      logger.warn("ADVERSARIAL: Delaying execution payload reveal", {...logCtx, delayBps, delayMs});
      await sleep(delayMs, this.modules.signal);
    }

    try {
      await envelopePublisher.publish(contents, this.modules.signal);
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
