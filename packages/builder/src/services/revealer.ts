import {ChainForkConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD} from "@lodestar/params";
import {IClock} from "@lodestar/state-transition";
import {BuilderIndex} from "@lodestar/types";
import {Logger, prettyGweiToEth, toRootHex} from "@lodestar/utils";
import {Metrics, RevealResult} from "../metrics.js";
import {BidLedger} from "./bidLedger.js";
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
