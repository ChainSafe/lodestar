import {routes} from "@lodestar/api";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {BeaconChain} from "../chain.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {PayloadError, PayloadErrorType} from "./payloadError.js";
import {ImportPayloadOpts} from "./types.js";
import {verifyPayloadsDataAvailability} from "./verifyPayloadsDataAvailability.js";

export {PayloadError, PayloadErrorCode} from "./payloadError.js";

const EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS = 64;

export class PayloadImportError extends PayloadError {
  constructor(
    readonly payloadInput: PayloadEnvelopeInput,
    type: PayloadErrorType,
    message?: string
  ) {
    super(type, message);
  }
}

/**
 * Import an execution payload envelope after all data is available.
 *
 * The envelope is only verified here, no state mutation. State effects from the payload
 * are applied on the next block via processParentExecutionPayload.
 *
 * The DA wait must have run upstream (range sync awaits DA in `verifyBlocksInEpoch` for the
 * whole segment; gossip / API path uses the `processExecutionPayload` wrapper below).
 *
 * [beacon-engine] moved from unstable@1bf214377e chain/blocks/importExecutionPayload.ts:
 * consensus/EL verification, envelope persistence, fork choice and FCU live in
 * chain/beaconEngine/importExecutionPayload.ts. Sync upstream steps 2-7 there;
 * keep DA, column writes, input error context and source metrics here.
 */
export async function importExecutionPayload(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput,
  dataAvailabilityStatus: DataAvailabilityStatus,
  opts: ImportPayloadOpts = {}
): Promise<void> {
  try {
    await importExecutionPayloadInner.call(this, payloadInput, dataAvailabilityStatus, opts);
  } catch (e) {
    if (e instanceof PayloadError) throw new PayloadImportError(payloadInput, e.type, e.message);
    throw e;
  }
}

async function importExecutionPayloadInner(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput,
  dataAvailabilityStatus: DataAvailabilityStatus,
  opts: ImportPayloadOpts = {}
): Promise<void> {
  const signedEnvelope = payloadInput.getPayloadEnvelope();
  const envelope = signedEnvelope.message;
  const slot = envelope.payload.slotNumber;
  const blockRootHex = payloadInput.blockRootHex;
  const blockHashHex = payloadInput.getBlockHashHex();

  // 1. Emit `execution_payload_available` event at the start of import. At this point the
  // payload input is already complete, so the payload and required data are available for
  // payload attestation. This event only signals availability (not validity), so we can emit
  // it before getting a response from the EL on whether the payload is valid or not.
  if (this.clock.currentSlot - slot < EVENTSTREAM_EMIT_RECENT_EXECUTION_PAYLOAD_SLOTS) {
    this.emitter.emit(routes.events.EventType.executionPayloadAvailable, {
      slot,
      blockRoot: blockRootHex,
    });
  }

  // Per-envelope SSZ bytes for engine persistence. Gossip
  // populates serializedCache; fall back to serializing on a cache miss so all call sites pass real bytes.
  const envelopeBytes =
    this.serializedCache.get(signedEnvelope) ?? ssz.gloas.SignedExecutionPayloadEnvelope.serialize(signedEnvelope);

  const {source, seenTimestampSec} = payloadInput.getPayloadEnvelopeSource();
  await this.beaconEngine.importExecutionPayload(envelopeBytes, dataAvailabilityStatus, {
    validSignature: opts.validSignature === true,
    source,
    seenTimestampSec,
  });

  // [beacon-engine] Upstream step 5 writes envelopes and columns together. Queue only columns
  // after the engine has verified and imported the envelope, retaining write-queue backpressure.
  await this.unfinalizedPayloadEnvelopeWrites.waitForSpace();
  this.unfinalizedPayloadEnvelopeWrites.push(payloadInput).catch((e) => {
    if (!isQueueErrorAborted(e)) {
      this.logger.error(
        "Error pushing payload envelope to unfinalized write queue",
        {slot, blockRoot: blockRootHex},
        e as Error
      );
    }
  });

  // 6. Record metrics for payload envelope and column sources
  const delaySec = this.clock.secFromSlot(slot);
  this.metrics?.importPayload.elapsedTimeTillImported.observe(
    {source: payloadInput.getPayloadEnvelopeSource().source},
    delaySec
  );
  for (const {source} of payloadInput.getSampledColumnsWithSource()) {
    this.metrics?.importPayload.columnsBySource.inc({source});
  }

  this.logger.verbose("Execution payload imported", {
    slot,
    builderIndex: envelope.builderIndex,
    blockRoot: blockRootHex,
    blockHash: blockHashHex,
    delaySec,
  });
}

/**
 * Process an execution payload envelope end-to-end: wait for DA, then import.
 *
 * Used by the PayloadEnvelopeProcessor queue (gossip / API / unknown-payload sync) — i.e.
 * callers that have NOT already awaited DA themselves. Range sync's inline dispatch in
 * processBlocks skips this wrapper and calls `importExecutionPayload` directly, since
 * `verifyBlocksInEpoch` already awaited DA for the segment.
 */
export async function processExecutionPayload(
  this: BeaconChain,
  payloadInput: PayloadEnvelopeInput,
  signal: AbortSignal,
  opts: ImportPayloadOpts = {}
): Promise<void> {
  const {dataAvailabilityStatuses} = await verifyPayloadsDataAvailability([payloadInput], signal);
  await importExecutionPayload.call(this, payloadInput, dataAvailabilityStatuses[0], opts);
}
