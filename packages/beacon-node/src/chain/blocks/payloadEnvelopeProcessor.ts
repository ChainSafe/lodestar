import {Metrics} from "../../metrics/metrics.js";
import {JobItemQueue} from "../../util/queue/index.js";
import type {BeaconChain} from "../chain.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {processExecutionPayload} from "./importExecutionPayload.js";
import {ImportPayloadOpts} from "./types.js";

// TODO GLOAS: Set to be equal to DEFAULT_MAX_PENDING_UNFINALIZED_PAYLOAD_ENVELOPE_WRITES for now
const QUEUE_MAX_LENGTH = 16;

enum PayloadEnvelopeImportStatus {
  queued = "queued",
  importing = "importing",
  imported = "imported",
}

/**
 * PayloadEnvelopeProcessor processes payload envelope jobs in a queued fashion, one after the other.
 *
 * Jobs are enqueued only on envelope arrival (gossip or API). The envelope may reach us before
 * the sampled data columns; importExecutionPayload awaits `verifyPayloadsDataAvailability`
 * internally, so a queued job can pend for up to `PAYLOAD_DATA_AVAILABILITY_TIMEOUT` while
 * waiting for columns. Duplicate triggers for the same payloadInput are deduped via `importStatus`.
 */
export class PayloadEnvelopeProcessor {
  readonly jobQueue: JobItemQueue<[PayloadEnvelopeInput, ImportPayloadOpts], void>;
  private readonly importStatus = new WeakMap<PayloadEnvelopeInput, PayloadEnvelopeImportStatus>();

  constructor(chain: BeaconChain, metrics: Metrics | null, signal: AbortSignal) {
    this.jobQueue = new JobItemQueue<[PayloadEnvelopeInput, ImportPayloadOpts], void>(
      (payloadInput, opts) => {
        this.importStatus.set(payloadInput, PayloadEnvelopeImportStatus.importing);
        return processExecutionPayload.call(chain, payloadInput, signal, opts);
      },
      {maxLength: QUEUE_MAX_LENGTH, noYieldIfOneItem: true, signal},
      metrics?.payloadEnvelopeProcessorQueue ?? undefined
    );
  }

  async processPayloadEnvelopeJob(payloadInput: PayloadEnvelopeInput, opts: ImportPayloadOpts = {}): Promise<void> {
    if (this.importStatus.get(payloadInput) !== undefined) {
      return;
    }

    await this.jobQueue.waitForSpace();

    // Re-check after await, as another call may have queued this payload.
    if (this.importStatus.get(payloadInput) !== undefined) {
      return;
    }

    this.importStatus.set(payloadInput, PayloadEnvelopeImportStatus.queued);

    try {
      await this.jobQueue.push(payloadInput, opts);
      this.importStatus.set(payloadInput, PayloadEnvelopeImportStatus.imported);
    } catch (e) {
      this.importStatus.delete(payloadInput);
      throw e;
    }
  }
}
