import {ApiClient, ApiError, HttpStatusCode} from "@lodestar/api";
import {Genesis} from "@lodestar/types/phase0";
import {Logger, sleep} from "@lodestar/utils";

/** The time between polls when waiting for genesis */
const WAITING_FOR_GENESIS_POLL_MS = 12 * 1000;

export async function waitForGenesis(api: ApiClient, logger: Logger, signal: AbortSignal): Promise<Genesis> {
  while (true) {
    try {
      return (await api.beacon.getGenesis()).value();
    } catch (e) {
      if (e instanceof ApiError && e.status === HttpStatusCode.NOT_FOUND) {
        logger.info("Waiting for genesis", {message: e.message});
      } else {
        logger.warn("Failed to fetch genesis", {message: (e as Error).message});
      }
      await sleep(WAITING_FOR_GENESIS_POLL_MS, signal);
    }
  }
}
