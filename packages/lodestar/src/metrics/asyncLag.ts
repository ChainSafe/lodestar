import {AbortSignal} from "@chainsafe/abort-controller";
import {isErrorAborted, sleep} from "@chainsafe/lodestar-utils";
import {ILodestarMetrics} from "./metrics/lodestar";

/**
 * Track async lag, the difference between when a setTimeout() should execute, and when it actually execute.
 * Is setTimeout(0, fn) is called at second 0.000s, and fn() is called at 0.053s async lag is 0.053s.
 * When a node is overloaded with many tasks, such as incoming gossip, REST calls, the event loop fills up
 * and callbacks take longer to execute. This metrics estimates this lag by sampling the event loop async
 * delay once per `intervalMs`.
 *
 * @param intervalMs How frequently to sample async lag, recommended to set to a "high" value of >= 1sec.
 */
export async function trackAsyncLag(metrics: ILodestarMetrics, intervalMs: number, signal: AbortSignal): Promise<void> {
  try {
    const intervalSec = intervalMs / 1e3;
    let prevTimeNs = process.hrtime.bigint();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      await sleep(intervalMs, signal);

      const newTimeNs = process.hrtime.bigint();
      const diffSec = Number(newTimeNs - prevTimeNs) / 1e6;
      metrics.asyncLag.observe(diffSec - intervalSec);

      prevTimeNs = newTimeNs;
    }
  } catch (e) {
    if (isErrorAborted(e)) {
      return;
    } else {
      throw e;
    }
  }
}
