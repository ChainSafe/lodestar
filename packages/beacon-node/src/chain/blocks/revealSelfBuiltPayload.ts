import {routes} from "@lodestar/api";
import {PayloadStatus} from "@lodestar/fork-choice";
import {NUMBER_OF_COLUMNS, isForkPostGloas} from "@lodestar/params";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {RootHex, Slot, gloas} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {getGloasDataColumnSidecars} from "../../util/dataColumns.js";
import type {BeaconChain} from "../chain.js";
import {ChainEvent} from "../emitter.js";
import {BlockType, ProduceFullGloas} from "../produceBlock/index.js";
import {OpSource} from "../validatorMonitor.js";
import {PayloadEnvelopeInput, PayloadEnvelopeInputSource} from "./payloadEnvelopeInput/index.js";

/** Delay before a broadcast that failed is tried again */
export const SELF_BUILT_PAYLOAD_REVEAL_RETRY_MS = 500;
/** Broadcasts the node attempts by itself per block, the first one included */
export const SELF_BUILT_PAYLOAD_REVEAL_MAX_ATTEMPTS = 4;
/** How long a request to the publish API waits for a broadcast of the node */
export const SELF_BUILT_PAYLOAD_REVEAL_WAIT_MS = 2000;

/**
 * Outcome of a broadcast of an execution payload envelope and its data columns. The envelope and each data column
 * are published on their own, one failing does not fail the others
 */
export type PublishExecutionPayloadEnvelopeResult = {
  /** Why the envelope was not published, null if it was or if none was to be published */
  envelopeError: Error | null;
  /** Why data columns were not published, by column index */
  columnErrors: Map<number, Error>;
};

/** The reveal of the execution payload of a self-built block, see `revealSelfBuiltPayload` */
export type SelfBuiltPayloadReveal = {
  readonly slot: Slot;
  readonly payload: SelfBuiltPayload;
  readonly builderIndex: number;
  readonly payloadRootHex: RootHex;
  readonly seenTimestampSec: number;
  /** The envelope was broadcast */
  envelopePublished: boolean;
  /** Indices of the data columns that are yet to be broadcast */
  readonly unpublishedColumns: Set<number>;
  /** Broadcasts attempted so far */
  attempts: number;
  /** Settles once the broadcast that is in flight is done, never rejects. Null if none is in flight */
  inFlight: Promise<void> | null;
  retryTimer: NodeJS.Timeout | null;
};

export type SelfBuiltPayloadRevealOutcome = {
  envelopePublished: boolean;
  /** Number of data columns that are yet to be broadcast */
  unpublishedColumns: number;
  /** A broadcast is still in flight, its outcome is not known */
  inFlight: boolean;
};

/**
 * Self-built blocks whose execution payload this node reveals, by block root. Owns the retry timers of the
 * reveals, none is left once it is closed
 */
export class SelfBuiltPayloadReveals {
  private readonly reveals = new Map<RootHex, SelfBuiltPayloadReveal>();
  private readonly abortController = new AbortController();

  get closed(): boolean {
    return this.abortController.signal.aborted;
  }

  get size(): number {
    return this.reveals.size;
  }

  get(blockRootHex: RootHex): SelfBuiltPayloadReveal | undefined {
    return this.reveals.get(blockRootHex);
  }

  has(blockRootHex: RootHex): boolean {
    return this.reveals.has(blockRootHex);
  }

  set(blockRootHex: RootHex, reveal: SelfBuiltPayloadReveal): void {
    if (this.closed) {
      throw Error("Self-built payload reveals are closed");
    }
    this.reveals.set(blockRootHex, reveal);
  }

  /** Drop the reveals of the blocks that are not to be kept, and their pending retries */
  prune(keep: (blockRootHex: RootHex) => boolean): void {
    for (const [blockRootHex, reveal] of this.reveals) {
      if (!keep(blockRootHex)) {
        cancelRetry(reveal);
        this.reveals.delete(blockRootHex);
      }
    }
  }

  /** Cancel every pending retry and wait. A broadcast in flight is not retried, and no reveal is started */
  close(): void {
    this.abortController.abort();
    for (const reveal of this.reveals.values()) {
      cancelRetry(reveal);
    }
    this.reveals.clear();
  }

  /** Wait for a broadcast in flight, for a bounded time and not beyond `close()` */
  async waitFor(inFlight: Promise<void>, timeoutMs: number): Promise<void> {
    const signal = this.abortController.signal;
    if (signal.aborted) {
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    try {
      await Promise.race([
        inFlight,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
          onAbort = () => resolve();
          signal.addEventListener("abort", onAbort, {once: true});
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }
}

function cancelRetry(reveal: SelfBuiltPayloadReveal): void {
  if (reveal.retryTimer !== null) {
    clearTimeout(reveal.retryTimer);
    reveal.retryTimer = null;
  }
}

function isRevealed(reveal: SelfBuiltPayloadReveal): boolean {
  return reveal.envelopePublished && reveal.unpublishedColumns.size === 0;
}

/**
 * Reveal the execution payload of a block this node built itself.
 *
 * The envelope is not signed, so the node that built the payload does not need the validator client to release
 * it. It broadcasts the envelope and its data columns as soon as it has broadcast or imported the block, however
 * the block arrived (publish API or gossip), and imports the payload once the block is in fork choice.
 *
 * Must only be called for a block whose proposer signature was verified, and which this node has broadcast or
 * imported: once the publish API has broadcast the block, and once the block is imported. The call after the
 * import does not depend on the broadcast of the block, it also reveals the payload of a block whose broadcast by
 * this node failed. Such a block is self-built, validly signed and in fork choice.
 *
 * The first call for a block root starts the reveal, and gives the envelope and the data columns to the
 * `PayloadEnvelopeInput` of the block. Every call imports the payload if the block is in fork choice and the
 * payload is not, whether or not the broadcast succeeded. The envelope and the data columns are broadcast at most
 * once each, unless their broadcast fails: what failed, and only that, is broadcast again after
 * `SELF_BUILT_PAYLOAD_REVEAL_RETRY_MS`, for at most `SELF_BUILT_PAYLOAD_REVEAL_MAX_ATTEMPTS` attempts and not after
 * the slot of the block. The publish API completes a reveal as well, see `completeSelfBuiltPayloadReveal`.
 *
 * Does nothing for a block this node did not build, or built on a builder's bid, or whose envelope was already
 * received, and does not start to reveal the payload of a block from a slot that has passed.
 *
 * Never throws. Returns true if this call started the reveal.
 */
export function revealSelfBuiltPayload(this: BeaconChain, blockRootHex: RootHex): boolean {
  try {
    return maybeRevealSelfBuiltPayload.call(this, blockRootHex);
  } catch (e) {
    this.logger.error("Error revealing self-built execution payload", {blockRoot: blockRootHex}, e as Error);
    return false;
  }
}

/**
 * Complete the reveal of a self-built payload on behalf of a request to the publish API, so that the request
 * does not broadcast what the node is broadcasting or has broadcast. Waits for a broadcast in flight, for at most
 * `SELF_BUILT_PAYLOAD_REVEAL_WAIT_MS`, and then broadcasts what is still missing, once.
 *
 * Returns null, synchronously, if this node does not reveal the payload of the block. The promise never rejects.
 */
export function completeSelfBuiltPayloadReveal(
  this: BeaconChain,
  blockRootHex: RootHex
): Promise<SelfBuiltPayloadRevealOutcome> | null {
  const reveal = this.selfBuiltPayloadReveals.get(blockRootHex);
  if (reveal === undefined) {
    return null;
  }
  return waitForSelfBuiltPayloadReveal.call(this, blockRootHex, reveal);
}

async function waitForSelfBuiltPayloadReveal(
  this: BeaconChain,
  blockRootHex: RootHex,
  reveal: SelfBuiltPayloadReveal
): Promise<SelfBuiltPayloadRevealOutcome> {
  const reveals = this.selfBuiltPayloadReveals;
  try {
    if (reveal.inFlight !== null) {
      await reveals.waitFor(reveal.inFlight, SELF_BUILT_PAYLOAD_REVEAL_WAIT_MS);
    }
    // Not through a retry that started meanwhile, and not if the reveal was pruned or closed
    if (!isRevealed(reveal) && reveal.inFlight === null && reveals.get(blockRootHex) === reveal) {
      cancelRetry(reveal);
      await reveals.waitFor(
        publishSelfBuiltPayload.call(this, blockRootHex, reveal),
        SELF_BUILT_PAYLOAD_REVEAL_WAIT_MS
      );
    }
  } catch (e) {
    this.logger.error("Error completing self-built execution payload reveal", {blockRoot: blockRootHex}, e as Error);
  }

  return {
    envelopePublished: reveal.envelopePublished,
    unpublishedColumns: reveal.unpublishedColumns.size,
    inFlight: reveal.inFlight !== null,
  };
}

function maybeRevealSelfBuiltPayload(this: BeaconChain, blockRootHex: RootHex): boolean {
  const produceResult = this.blockProductionCache.get(blockRootHex);
  if (
    produceResult === undefined ||
    !isForkPostGloas(produceResult.fork) ||
    produceResult.type !== BlockType.Full ||
    // Blocks committing to a builder bid are cached as full but without payload data
    (produceResult as ProduceFullGloas).executionPayload === undefined
  ) {
    return false;
  }

  // Seeded from the block before it is broadcast or imported, on every path
  const payloadInput = this.seenPayloadEnvelopeInputCache.get(blockRootHex);
  if (payloadInput === undefined) {
    return false;
  }

  const reveals = this.selfBuiltPayloadReveals;
  const reveal = reveals.get(blockRootHex);
  if (reveal !== undefined) {
    // The payload can only be imported once its block is in fork choice. If the block was broadcast before it was
    // imported, the call after the import gets here. The PayloadEnvelopeInput may have been pruned and created
    // again from the block since the reveal started
    seedPayloadInput(payloadInput, reveal.payload, reveal.seenTimestampSec);
    importSelfBuiltPayload.call(this, payloadInput);
    return false;
  }

  // An envelope that is already there was received on gossip or submitted to the publish API by the validator
  // client, which broadcast and import it themselves
  if (payloadInput.hasPayloadEnvelope()) {
    return false;
  }

  // The payload of a late block is not revealed, it could only be seen after the slot it was built for
  const slot = payloadInput.slot;
  if (slot < this.clock.currentSlot) {
    this.logger.warn("Self-built block is from a past slot, not revealing its execution payload", {
      slot,
      currentSlot: this.clock.currentSlot,
      blockRoot: blockRootHex,
    });
    return false;
  }

  if (reveals.closed) {
    return false;
  }

  if (this.emitter.listenerCount(ChainEvent.publishExecutionPayloadEnvelope) === 0) {
    throw Error("No publisher for the execution payload envelope");
  }

  const payload = buildSelfBuiltPayload(blockRootHex, produceResult as ProduceFullGloas);
  const newReveal: SelfBuiltPayloadReveal = {
    slot,
    payload,
    builderIndex: payloadInput.getBuilderIndex(),
    payloadRootHex: payloadInput.getPayloadRootHex(),
    seenTimestampSec: Date.now() / 1000,
    envelopePublished: false,
    unpublishedColumns: new Set(payload.dataColumnSidecars.map((sidecar) => sidecar.index)),
    attempts: 0,
    inFlight: null,
    retryTimer: null,
  };
  reveals.set(blockRootHex, newReveal);

  this.logger.debug("Revealing self-built execution payload envelope", {
    slot,
    blockRoot: blockRootHex,
    blockHash: toRootHex(payload.envelope.payload.blockHash),
    dataColumns: payload.dataColumnSidecars.length,
  });

  // This node built the payload, it does not depend on the broadcast to know and import it
  seedPayloadInput(payloadInput, payload, newReveal.seenTimestampSec);
  void publishSelfBuiltPayload.call(this, blockRootHex, newReveal);
  importSelfBuiltPayload.call(this, payloadInput);

  return true;
}

/**
 * Broadcast what is yet to be broadcast of a self-built payload, and try again later if it fails. Never throws,
 * the returned promise settles once the broadcast is done and never rejects
 */
function publishSelfBuiltPayload(
  this: BeaconChain,
  blockRootHex: RootHex,
  reveal: SelfBuiltPayloadReveal
): Promise<void> {
  const envelope = reveal.envelopePublished ? null : reveal.payload.envelope;
  const dataColumnSidecars =
    reveal.unpublishedColumns.size === reveal.payload.dataColumnSidecars.length
      ? reveal.payload.dataColumnSidecars
      : reveal.payload.dataColumnSidecars.filter((sidecar) => reveal.unpublishedColumns.has(sidecar.index));

  reveal.attempts++;
  let onDone: () => void = () => {};
  const inFlight = new Promise<void>((resolve) => {
    onDone = resolve;
  });
  reveal.inFlight = inFlight;

  const onPublished = (result: PublishExecutionPayloadEnvelopeResult): void => {
    // Reported once per broadcast
    if (reveal.inFlight !== inFlight) {
      return;
    }
    reveal.inFlight = null;
    try {
      onSelfBuiltPayloadPublished.call(this, blockRootHex, reveal, envelope, dataColumnSidecars, result);
    } catch (e) {
      this.logger.error(
        "Error handling the broadcast of a self-built execution payload",
        {slot: reveal.slot, blockRoot: blockRootHex},
        e as Error
      );
    } finally {
      onDone();
    }
  };

  try {
    if (this.emitter.listenerCount(ChainEvent.publishExecutionPayloadEnvelope) === 0) {
      throw Error("No publisher for the execution payload envelope");
    }
    this.emitter.emit(ChainEvent.publishExecutionPayloadEnvelope, envelope, dataColumnSidecars, onPublished);
  } catch (e) {
    // Nothing was published as far as this node knows
    onPublished({
      envelopeError: envelope === null ? null : (e as Error),
      columnErrors: new Map(dataColumnSidecars.map((sidecar) => [sidecar.index, e as Error])),
    });
  }

  return inFlight;
}

function onSelfBuiltPayloadPublished(
  this: BeaconChain,
  blockRootHex: RootHex,
  reveal: SelfBuiltPayloadReveal,
  envelope: gloas.ExecutionPayloadEnvelope | null,
  dataColumnSidecars: gloas.DataColumnSidecar[],
  {envelopeError, columnErrors}: PublishExecutionPayloadEnvelopeResult
): void {
  // Pruned or closed while the broadcast was in flight
  if (this.selfBuiltPayloadReveals.get(blockRootHex) !== reveal) {
    return;
  }

  const {slot} = reveal;
  const envelopePublishedNow = envelope !== null && envelopeError === null;
  if (envelopePublishedNow) {
    reveal.envelopePublished = true;
  }
  for (const {index} of dataColumnSidecars) {
    if (!columnErrors.has(index)) {
      reveal.unpublishedColumns.delete(index);
    }
  }

  const willRetry = !isRevealed(reveal) && scheduleRetry.call(this, blockRootHex, reveal);
  const logCtx = {slot, blockRoot: blockRootHex, attempt: reveal.attempts, willRetry};
  if (envelope !== null && envelopeError !== null) {
    this.logger.warn("Error publishing self-built execution payload envelope", logCtx, envelopeError);
  }
  if (columnErrors.size > 0) {
    this.logger.warn(
      "Error publishing data columns of self-built execution payload",
      {...logCtx, failedColumns: columnErrors.size, columns: dataColumnSidecars.length},
      columnErrors.values().next().value
    );
  }

  if (envelopePublishedNow) {
    const {envelope: revealedEnvelope} = reveal.payload;
    const blockHash = toRootHex(revealedEnvelope.payload.blockHash);
    const delaySec = reveal.seenTimestampSec - computeTimeAtSlot(this.config, slot, this.genesisTime);
    this.metrics?.gossipExecutionPayloadEnvelope.elapsedTimeTillReceived.observe({source: OpSource.api}, delaySec);
    this.validatorMonitor?.registerExecutionPayloadEnvelope(OpSource.api, delaySec, revealedEnvelope);

    if (this.opts.persistProducedPayloadEnvelopes) {
      this.persistExecutionPayloadEnvelope(revealedEnvelope);
    }

    this.logger.info("Revealed self-built execution payload envelope", {
      slot,
      blockRoot: blockRootHex,
      blockHash,
      dataColumns: reveal.payload.dataColumnSidecars.length,
      unpublishedDataColumns: reveal.unpublishedColumns.size,
      attempt: reveal.attempts,
      delaySec,
    });

    this.emitter.emit(routes.events.EventType.executionPayloadGossip, {
      slot,
      builderIndex: reveal.builderIndex,
      blockHash,
      payloadRoot: reveal.payloadRootHex,
      blockRoot: blockRootHex,
    });
  }
}

/**
 * Broadcast what failed again after a delay, unless the attempts are used up or the slot of the block has
 * passed. Returns false if it is not tried again
 */
function scheduleRetry(this: BeaconChain, blockRootHex: RootHex, reveal: SelfBuiltPayloadReveal): boolean {
  if (reveal.retryTimer !== null) {
    return true;
  }
  if (reveal.attempts >= SELF_BUILT_PAYLOAD_REVEAL_MAX_ATTEMPTS || this.clock.currentSlot > reveal.slot) {
    return false;
  }

  reveal.retryTimer = setTimeout(() => {
    reveal.retryTimer = null;
    try {
      // Pruned or closed meanwhile, or completed through the publish API
      if (this.selfBuiltPayloadReveals.get(blockRootHex) !== reveal || reveal.inFlight !== null || isRevealed(reveal)) {
        return;
      }
      if (this.clock.currentSlot > reveal.slot) {
        this.logger.warn("Slot has passed, not publishing self-built execution payload again", {
          slot: reveal.slot,
          blockRoot: blockRootHex,
          envelopePublished: reveal.envelopePublished,
          unpublishedDataColumns: reveal.unpublishedColumns.size,
        });
        return;
      }
      void publishSelfBuiltPayload.call(this, blockRootHex, reveal);
    } catch (e) {
      this.logger.error(
        "Error retrying self-built execution payload reveal",
        {slot: reveal.slot, blockRoot: blockRootHex},
        e as Error
      );
    }
  }, SELF_BUILT_PAYLOAD_REVEAL_RETRY_MS);
  return true;
}

type SelfBuiltPayload = {
  envelope: gloas.ExecutionPayloadEnvelope;
  dataColumnSidecars: gloas.DataColumnSidecar[];
};

function buildSelfBuiltPayload(blockRootHex: RootHex, produceResult: ProduceFullGloas): SelfBuiltPayload {
  const {executionPayload, executionRequests, blobsBundle, cells, parentBlockRoot} = produceResult;

  const envelope: gloas.ExecutionPayloadEnvelope = {
    payload: executionPayload,
    executionRequests,
    beaconBlockRoot: fromHex(blockRootHex),
    parentBeaconBlockRoot: parentBlockRoot,
  };

  const cellsAndProofs = cells.map((rowCells, rowIndex) => ({
    cells: rowCells,
    proofs: blobsBundle.proofs.slice(rowIndex * NUMBER_OF_COLUMNS, (rowIndex + 1) * NUMBER_OF_COLUMNS),
  }));
  const dataColumnSidecars = getGloasDataColumnSidecars(
    executionPayload.slotNumber,
    envelope.beaconBlockRoot,
    cellsAndProofs
  );

  return {envelope, dataColumnSidecars};
}

/** Give the `PayloadEnvelopeInput` the envelope and data columns of the revealed payload, unless it has them */
function seedPayloadInput(
  payloadInput: PayloadEnvelopeInput,
  {envelope, dataColumnSidecars}: SelfBuiltPayload,
  seenTimestampSec = Date.now() / 1000
): void {
  if (!payloadInput.hasPayloadEnvelope()) {
    payloadInput.addPayloadEnvelope({
      envelope,
      source: PayloadEnvelopeInputSource.api,
      seenTimestampSec,
      peerIdStr: undefined,
    });
  }
  for (const columnSidecar of dataColumnSidecars) {
    if (!payloadInput.hasColumn(columnSidecar.index)) {
      payloadInput.addColumn({
        columnSidecar,
        source: PayloadEnvelopeInputSource.api,
        seenTimestampSec,
        peerIdStr: undefined,
      });
    }
  }
}

function importSelfBuiltPayload(this: BeaconChain, payloadInput: PayloadEnvelopeInput): void {
  const blockRootHex = payloadInput.blockRootHex;
  if (
    this.forkChoice.hasBlockHex(blockRootHex) &&
    this.forkChoice.getBlockHex(blockRootHex, PayloadStatus.FULL) === null
  ) {
    this.processExecutionPayload(payloadInput, {validEnvelope: false}).catch((e) => {
      this.logger.error(
        "Error importing self-built execution payload",
        {slot: payloadInput.slot, blockRoot: blockRootHex},
        e as Error
      );
    });
  }
}
