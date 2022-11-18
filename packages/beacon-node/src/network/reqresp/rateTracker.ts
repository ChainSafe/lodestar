import {MapDef} from "@lodestar/utils";

type RateTrackerOpts = {
  limit: number;
  timeoutMs: number;
};

const BUCKET_SIZE_MS = 1000;

/**
 * The generic rate tracker allows up to `limit` objects in a period of time.
 * This could apply to both request count or block count, for both requests and responses.
 */
export class RateTracker {
  private requestsWithinWindow = 0;
  private limit: number;
  private timeoutMs: number;
  /** Key as time in second and value as object requested */
  private requests: MapDef<number, number>;

  constructor(opts: RateTrackerOpts, requests = new MapDef<number, number>(() => 0)) {
    this.limit = opts.limit;
    this.timeoutMs = opts.timeoutMs;
    this.requests = requests;
  }

  requestObjects(objectCount: number): number {
    if (objectCount <= 0) throw Error("Invalid objectCount " + objectCount);
    this.prune();
    if (this.requestsWithinWindow >= this.limit) {
      return 0;
    }

    this.requestsWithinWindow += objectCount;
    const key = Math.floor(Date.now() / BUCKET_SIZE_MS);
    const curObjectCount = this.requests.getOrDefault(key);
    this.requests.set(key, curObjectCount + objectCount);

    return objectCount;
  }

  getRequestedObjectsWithinWindow(): number {
    return this.requestsWithinWindow;
  }

  private prune(): void {
    const now = Date.now();

    for (const [timeInSec, count] of this.requests.entries()) {
      // reclaim the quota for old requests
      if (now - timeInSec * BUCKET_SIZE_MS >= this.timeoutMs) {
        this.requestsWithinWindow -= count;
        this.requests.delete(timeInSec);
      } else {
        // Break after the first entry within the timeout window.
        // Since the entries are added in order, all the rest will be within the window.
        break;
      }
    }

    if (this.requestsWithinWindow < 0) {
      this.requestsWithinWindow = 0;
    }
  }
}
