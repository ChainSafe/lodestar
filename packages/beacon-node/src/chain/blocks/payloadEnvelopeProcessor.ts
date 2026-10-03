import {Metrics} from "../../metrics/metrics.js";
import {JobItemQueue} from "../../util/queue/index.js";
import type {BeaconChain} from "../chain.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {processExecutionPayload} from "./importExecutionPayload.js";
import {ImportPayloadOpts} from "./types.js";

// TODO GLOAS: Set to be equal to DEFAULT_MAX_PENDING_UNFINALIZED_PAYLOAD_ENVELOPE_WRITES for now
const QUEUE_MAX_LENGTH = 16;

/**
 * PayloadEnvelopeProcessor processes payload envelope jobs in a queued fashion, one after the other.
 *
 * Jobs are enqueued only on envelope arrival (gossip or API). The envelope may reach us before
 * the sampled data columns; importExecutionPayload awaits `verifyPayloadsDataAvailability`
 * internally, so a queued job can pend for up to `PAYLOAD_DATA_AVAILABILITY_TIMEOUT` while
 * waiting for columns. Duplicate triggers for the same payloadInput are deduped by sharing the
 * in-flight import promise: every caller observes the real import outcome. Resolving duplicates
 * early instead would let BlockInputSync mark a still-pending payload as processed, re-queue it,
 * and spin re-processing the same root until OOM while the import is blocked (e.g. EL syncing).
 */
export class PayloadEnvelopeProcessor {
  readonly jobQueue: JobItemQueue<[PayloadEnvelopeInput, ImportPayloadOpts], void>;
  private readonly imports = new WeakMap<PayloadEnvelopeInput, Promise<void>>();

  constructor(chain: BeaconChain, metrics: Metrics | null, signal: AbortSignal) {
    this.jobQueue = new JobItemQueue<[PayloadEnvelopeInput, ImportPayloadOpts], void>(
      (payloadInput, opts) => {
        return processExecutionPayload.call(chain, payloadInput, signal, opts);
      },
      {maxLength: QUEUE_MAX_LENGTH, noYieldIfOneItem: true, signal},
      metrics?.payloadEnvelopeProcessorQueue ?? undefined
    );
  }

  async processPayloadEnvelopeJob(payloadInput: PayloadEnvelopeInput, opts: ImportPayloadOpts = {}): Promise<void> {
    const existing = this.imports.get(payloadInput);
    if (existing) {
      return existing;
    }

    await this.jobQueue.waitForSpace();

    // Re-check after await, as another call may have queued this payload.
    const queued = this.imports.get(payloadInput);
    if (queued) {
      return queued;
    }

    const importPromise = this.jobQueue.push(payloadInput, opts);
    this.imports.set(payloadInput, importPromise);

    try {
      await importPromise;
    } catch (e) {
      // Drop the failed import so a later attempt can retry once the failure cause is resolved
      // (e.g. BLOCK_NOT_IN_FORK_CHOICE after the block lands in fork choice)
      this.imports.delete(payloadInput);
      throw e;
    }
  }
}
