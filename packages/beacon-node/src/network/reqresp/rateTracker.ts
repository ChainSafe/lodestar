import {MapDef} from "@lodestar/utils";

type RateTrackerOpts = {
  limit: number;
  limitTimeMs: number;
};

const MS_IN_SEC = 1000;

type TimeInSec = number;
type RequestsCount = number;

export const getCurrentTimeInSec = (): number => Math.floor(Date.now() / MS_IN_SEC);

/**
 * The generic rate tracker allows up to `limit` objects in a period of time.
 * This could apply to both request count or block count, for both requests and responses.
 */
export class RateTracker {
  private currentWindowCount = 0;
  private limit: number;
  private limitTimeMs: number;
  /** Key as time in second and value as object requested */
  private secondsMap: MapDef<TimeInSec, RequestsCount>;

  constructor(opts: RateTrackerOpts, requestsCounts = new MapDef<TimeInSec, RequestsCount>(() => 0)) {
    this.limit = opts.limit;
    this.limitTimeMs = opts.limitTimeMs;
    this.secondsMap = requestsCounts;
  }

  requestObjects(objectCount: number): number {
    if (objectCount <= 0) throw Error("Invalid objectCount " + objectCount);
    if (objectCount > this.limit) {
      return 0;
    }

    this.prune();

    if (this.currentWindowCount >= this.limit) {
      return 0;
    }

    this.currentWindowCount += objectCount;
    const key = getCurrentTimeInSec();
    const curObjectCount = this.secondsMap.getOrDefault(key);
    this.secondsMap.set(key, curObjectCount + objectCount);

    return objectCount;
  }

  getRequestedObjectsWithinWindow(): number {
    return this.currentWindowCount;
  }

  private prune(): void {
    const now = Date.now();

    for (const [timeInSec, count] of this.secondsMap.entries()) {
      // reclaim the quota for old requests
      if (now - timeInSec * MS_IN_SEC >= this.limitTimeMs) {
        this.currentWindowCount -= count;
        this.secondsMap.delete(timeInSec);
      } else {
        // Break after the first entry within the timeout window.
        // Since the entries are added in order, all the rest will be within the window.
        break;
      }
    }

    if (this.currentWindowCount < 0) {
      this.currentWindowCount = 0;
    }
  }
}
