import {ChainForkConfig} from "@lodestar/config";
import {IClock} from "@lodestar/state-transition";
import {BuilderIndex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {Metrics, RevealResult} from "../metrics.js";
import {BidSelector} from "./bidSelector.js";
import {ObservedBlock} from "./blockObserver.js";
import {EnvelopePublisher} from "./envelopePublisher.js";
import {createExecutionPayloadEnvelopeContents} from "./executionPayloadEnvelope.js";
import {PayloadStore} from "./payloadStore.js";

export type RevealerOptions = {
  /**
   * Latest point within the block's slot at which a reveal may start, in basis points.
   * Defaults to the network's PAYLOAD_ATTESTATION_DUE_BPS
   */
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
