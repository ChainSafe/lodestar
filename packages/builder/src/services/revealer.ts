import {ApiClient, routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {isForkPostGloas} from "@lodestar/params";
import {IClock} from "@lodestar/state-transition";
import {BuilderIndex, RootHex, gloas, isGloasBeaconBlock} from "@lodestar/types";
import {Logger, fromHex, toRootHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {BuilderSigner} from "./builderSigner.js";
import {Ledger} from "./ledger.js";
import {PayloadStore} from "./payloadStore.js";

export type RevealerOpts = {
  /** Do not reveal after this point within the block's slot, in basis points */
  cutoffBps: number;
};

export type RevealerModules = {
  config: BeaconConfig;
  logger: Logger;
  clock: IClock;
  api: ApiClient;
  signer: BuilderSigner;
  store: PayloadStore;
  ledger: Ledger;
  builderIndex: BuilderIndex;
  metrics: Metrics | null;
};

export type BlockEvent = routes.events.EventData[routes.events.EventType.block];

/**
 * Reveals the payload once a block committing to one of our bids is imported by the beacon node.
 * The envelope is published together with blobs and proofs, the beacon node derives the data
 * column sidecars.
 */
export class Revealer {
  constructor(
    private readonly modules: RevealerModules,
    private readonly opts: RevealerOpts
  ) {}

  onBlock(event: BlockEvent): void {
    this.handleBlock(event).catch((e) => {
      this.modules.logger.error("Error revealing payload", {slot: event.slot, blockRoot: event.block}, e as Error);
    });
  }

  private async handleBlock(event: BlockEvent): Promise<void> {
    const {api, clock, config, ledger, logger, metrics, signer, store} = this.modules;
    const {slot, block: blockRoot} = event;

    if (!isForkPostGloas(config.getForkName(slot))) {
      return;
    }
    if (event.builderIndex !== undefined && event.builderIndex !== this.modules.builderIndex) {
      return;
    }

    const blockHash = event.blockHash ?? (await this.fetchCommittedBlockHash(blockRoot));
    if (blockHash === null) {
      return;
    }

    const logCtx = {slot, blockRoot, blockHash};
    const stored = store.get(blockHash);
    if (stored === null) {
      logger.warn("Block commits to our builder index but payload is unknown, cannot reveal", logCtx);
      metrics?.reveals.total.inc({result: "unknown_payload"});
      return;
    }

    ledger.recordWin(slot, blockHash, blockRoot);
    metrics?.bids.won.inc();

    if (ledger.hasRevealed(blockRoot)) {
      return;
    }
    if (!ledger.canReveal(blockRoot, blockHash)) {
      logger.error("Envelope already signed for block root with a different payload, not revealing", logCtx);
      metrics?.reveals.total.inc({result: "conflict"});
      return;
    }

    const msFromSlot = clock.msFromSlot(slot);
    const cutoffMs = config.getSlotComponentDurationMs(this.opts.cutoffBps);
    if (msFromSlot > cutoffMs) {
      logger.warn("Block with our bid arrived after reveal cutoff, not revealing", {...logCtx, msFromSlot, cutoffMs});
      metrics?.reveals.total.inc({result: "late"});
      return;
    }

    const {payload} = stored;
    const envelope: gloas.ExecutionPayloadEnvelope = {
      payload: payload.executionPayload,
      executionRequests: payload.executionRequests,
      builderIndex: this.modules.builderIndex,
      beaconBlockRoot: fromHex(blockRoot),
      parentBeaconBlockRoot: stored.parentBlockRoot,
    };
    const signedEnvelope = signer.signExecutionPayloadEnvelope(envelope);
    ledger.recordReveal(blockRoot, blockHash);

    try {
      (
        await api.beacon.publishExecutionPayloadEnvelope({
          signedEnvelopeOrContents: {
            signedExecutionPayloadEnvelope: signedEnvelope,
            kzgProofs: payload.blobsBundle.proofs,
            blobs: payload.blobsBundle.blobs,
          },
        })
      ).assertOk();
    } catch (e) {
      metrics?.reveals.total.inc({result: "publish_error"});
      throw e;
    }

    const secFromSlot = clock.secFromSlot(slot);
    metrics?.reveals.total.inc({result: "published"});
    metrics?.reveals.time.observe(secFromSlot);
    logger.info("Revealed execution payload", {
      ...logCtx,
      blobs: payload.blobsBundle.blobs.length,
      transactions: payload.executionPayload.transactions.length,
      secFromSlot,
    });
  }

  /** Beacon nodes that do not include the committed bid in the block event require a block fetch */
  private async fetchCommittedBlockHash(blockRoot: RootHex): Promise<RootHex | null> {
    const {api, logger} = this.modules;
    const signedBlock = (await api.beacon.getBlockV2({blockId: blockRoot})).value();
    if (!isGloasBeaconBlock(signedBlock.message)) {
      return null;
    }
    const bid = signedBlock.message.body.signedExecutionPayloadBid.message;
    if (bid.builderIndex !== this.modules.builderIndex) {
      return null;
    }
    logger.debug("Fetched block committing to our bid", {blockRoot, blockHash: toRootHex(bid.blockHash)});
    return toRootHex(bid.blockHash);
  }
}
