import {Metrics} from "../../metrics/metrics.js";
import {JobItemQueue} from "../../util/queue/index.js";
import type {BeaconChain} from "../chain.js";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {importExecutionPayload} from "./importExecutionPayload.js";
import {ImportPayloadOpts} from "./types.js";

// Set to be equal to DEFAULT_MAX_PENDING_UNFINALIZED_PAYLOAD_ENVELOPE_WRITES for now
const QUEUE_MAX_LENGTH = 16;

/**
 * PayloadEnvelopeProcessor processes payload envelope jobs in a queued fashion, one after the other.
 */
export class PayloadEnvelopeProcessor {
  readonly jobQueue: JobItemQueue<[PayloadEnvelopeInput, ImportPayloadOpts], void>;

  constructor(chain: BeaconChain, metrics: Metrics | null, signal: AbortSignal) {
    this.jobQueue = new JobItemQueue<[PayloadEnvelopeInput, ImportPayloadOpts], void>(
      (payloadInput, opts) => {
        return importExecutionPayload.call(chain, payloadInput, opts);
      },
      {maxLength: QUEUE_MAX_LENGTH, noYieldIfOneItem: true, signal},
      metrics?.payloadEnvelopeProcessorQueue ?? undefined
    );
  }

  async processPayloadEnvelopeJob(payloadInput: PayloadEnvelopeInput, opts: ImportPayloadOpts = {}): Promise<void> {
    await this.jobQueue.push(payloadInput, opts);
  }
}
