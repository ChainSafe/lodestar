import {Genesis} from "@lodestar/types/phase0";
import {Logger, sleep} from "@lodestar/utils";
import {Api, ApiError} from "@lodestar/api";

/** The time between polls when waiting for genesis */
const WAITING_FOR_GENESIS_POLL_MS = 12 * 1000;

export async function waitForGenesis(api: Api, logger: Logger, signal?: AbortSignal): Promise<Genesis> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await api.beacon.getGenesis();
      ApiError.assert(res, "Can not fetch genesis data from beacon node");
      return res.response.data;
    } catch (e) {
      // TODO: Search for a 404 error which indicates that genesis has not yet occurred.
      // Note: Lodestar API does not become online after genesis is found
      logger.info("Waiting for genesis", {message: (e as Error).message});
      await sleep(WAITING_FOR_GENESIS_POLL_MS, signal);
    }
  }
}
