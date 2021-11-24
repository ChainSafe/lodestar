import {MapDef} from "../../util/map";

/**
 * The generic rate tracker allows up to `limit` objects in a period of time.
 * This could apply to both request count or block count, for both requests and responses.
 */
export class RateTracker {
  private requestsWithinWindow = 0;
  private requests = new MapDef<number, number>(() => 0);

  constructor(private limit: number, private timeoutMs: number) {}

  requestObjects(objectCount: number): number {
    if (objectCount <= 0) throw Error("Invalid objectCount " + objectCount);
    this.prune();
    if (this.requestsWithinWindow >= this.limit) {
      return 0;
    }

    this.requestsWithinWindow += objectCount;
    const now = Date.now();
    const curObjectCount = this.requests.getOrDefault(now);
    this.requests.set(now, curObjectCount + objectCount);

    return objectCount;
  }

  getRequestedObjectsWithinWindow(): number {
    return this.requestsWithinWindow;
  }

  private prune(): void {
    const now = Date.now();

    for (const [time, count] of this.requests.entries()) {
      // reclaim the quota for old requests
      if (now - time >= this.timeoutMs) {
        this.requestsWithinWindow -= count;
        this.requests.delete(time);
      }
    }

    if (this.requestsWithinWindow < 0) {
      this.requestsWithinWindow = 0;
    }
  }
}
