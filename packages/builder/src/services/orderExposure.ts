import {randomUUID} from "node:crypto";
import type {AsyncCommitmentJournal} from "./asyncCommitmentJournal.js";

export type OrderExposureQuery = {
  version: 1;
  action: "query";
  orderId: string;
  namespace: string;
  generation: string;
  admittedAtUnixMs: number;
  admittedPublisherInstance: string;
};

export type OrderCommitment = {
  network: string;
  slot: number;
  builderIndex: number;
  parentBlockRoot: string;
  parentBlockHash: string;
  blockHash: string;
  signedBidRoot: string;
  possibleExposureAtUnixMs: number;
};

export type JournalExposure = {
  coverageComplete: boolean;
  commitmentCount: number;
  commitments: OrderCommitment[];
};

export type OrderExposureCapabilities = {
  version: 1;
  ready: boolean;
  publisherInstance: string;
  coverageSinceUnixMs: number;
  observedAtUnixMs: number;
};

export type OrderExposureResponse = {
  version: 1;
  orderId: string;
  namespace: string;
  generation: string;
  publisherInstance: string;
  observedAtUnixMs: number;
  barrierComplete: boolean;
  coverageComplete: boolean;
  priorCommitmentExposure: "none" | "possible" | "unknown";
  earliestPossibleOfferAtUnixMs: number | null;
  commitmentCount: number;
  commitments: OrderCommitment[];
  truncated: boolean;
};

export const MAX_EXPOSURE_COMMITMENTS = 64;
export const EXPOSURE_CLOCK_TOLERANCE_MS = 10;
const QUERY_TIMEOUT_MS = 1000;

/** The authenticated caller has already drained the native generation. This
 * barrier covers durable signatures, including writes with a lost acknowledgement. */
export class OrderExposure {
  private publisherInstance = randomUUID();
  private readonly coverageSinceUnixMs = Date.now();
  private lastUnix = this.coverageSinceUnixMs;
  private readonly firstMonotonic = performance.now();
  private failed = false;
  private querying = false;

  constructor(private readonly journals: readonly (AsyncCommitmentJournal | undefined)[]) {}

  capabilities(): OrderExposureCapabilities {
    this.checkCoverage();
    return {
      version: 1,
      ready: !this.failed,
      publisherInstance: this.publisherInstance,
      coverageSinceUnixMs: this.coverageSinceUnixMs,
      observedAtUnixMs: this.lastUnix,
    };
  }

  async query(request: OrderExposureQuery): Promise<OrderExposureResponse> {
    const capability = this.capabilities();
    if (this.querying) throw Error("ORDER_EXPOSURE_BUSY");
    this.querying = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const results: PromiseSettledResult<JournalExposure>[] = [];
      const pending = this.journals.map((journal) => {
        const query = journal
          ? journal.queryExposure(request.orderId, request.admittedAtUnixMs)
          : Promise.reject<JournalExposure>(Error("ORDER_EXPOSURE_JOURNAL_MISSING"));
        return query.then(
          (value) => {
            results.push({status: "fulfilled", value});
          },
          (reason: unknown) => {
            results.push({status: "rejected", reason});
          }
        );
      });
      const completed = Promise.all(pending).then(() => {
        this.querying = false;
      });
      await Promise.race([
        completed,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, QUERY_TIMEOUT_MS);
        }),
      ]);
      this.checkCoverage();
      const known = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      const barrierComplete = results.length === this.journals.length && known.length === this.journals.length;
      const coverageComplete =
        barrierComplete &&
        !this.failed &&
        capability.publisherInstance === this.publisherInstance &&
        request.admittedPublisherInstance === this.publisherInstance &&
        request.admittedAtUnixMs >= this.coverageSinceUnixMs &&
        request.admittedAtUnixMs <= Date.now() &&
        known.every((result) => result.coverageComplete);
      const commitmentCount = known.reduce((sum, result) => sum + result.commitmentCount, 0);
      const commitments = known
        .flatMap((result) => result.commitments)
        .sort((a, b) => a.possibleExposureAtUnixMs - b.possibleExposureAtUnixMs)
        .slice(0, MAX_EXPOSURE_COMMITMENTS);
      const times = commitments.map((record) => record.possibleExposureAtUnixMs);
      return {
        version: 1,
        orderId: request.orderId,
        namespace: request.namespace,
        generation: request.generation,
        publisherInstance: this.publisherInstance,
        observedAtUnixMs: Date.now(),
        barrierComplete,
        coverageComplete,
        priorCommitmentExposure: commitmentCount > 0 ? "possible" : coverageComplete ? "none" : "unknown",
        earliestPossibleOfferAtUnixMs: times.length > 0 ? Math.min(...times) : null,
        commitmentCount,
        commitments,
        truncated: commitmentCount > commitments.length,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private checkCoverage(): void {
    const unix = Date.now();
    const monotonic = performance.now();
    if (
      !this.failed &&
      (this.journals.length === 0 ||
        this.journals.some((journal) => !journal?.isHealthy()) ||
        unix < this.lastUnix ||
        Math.abs(unix - this.coverageSinceUnixMs - (monotonic - this.firstMonotonic)) > EXPOSURE_CLOCK_TOLERANCE_MS)
    ) {
      this.failed = true;
      this.publisherInstance = randomUUID();
    }
    this.lastUnix = unix;
  }
}
