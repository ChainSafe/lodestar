import {MapDef} from "../../util/map";

/**
 * The generic rate tracker allows up to `limit` objects in a period of time.
 * This could apply to both request count or block count, for both requests and responses.
 */
export class RateTracker {
  private requestsWithinWindow = 0;
  /** Key as time in second and value as object requested */
  private requests = new MapDef<number, number>(() => 0);

  constructor(private limit: number, private timeoutMs: number) {}

  requestObjects(objectCount: number): number {
    if (objectCount <= 0) throw Error("Invalid objectCount " + objectCount);
    this.prune();
    if (this.requestsWithinWindow >= this.limit) {
      return 0;
    }

    this.requestsWithinWindow += objectCount;
    const key = Math.floor(Date.now() / 1000);
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
      if (now - timeInSec * 1000 >= this.timeoutMs) {
        this.requestsWithinWindow -= count;
        this.requests.delete(timeInSec);
      }
    }

    if (this.requestsWithinWindow < 0) {
      this.requestsWithinWindow = 0;
    }
  }
}
