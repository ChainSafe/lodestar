import {AbortSignal} from "abort-controller";
import {Genesis} from "@chainsafe/lodestar-types/phase0";
import {ILogger, sleep} from "@chainsafe/lodestar-utils";
import {IApiClient} from "./api";

/** The time between polls when waiting for genesis */
const WAITING_FOR_GENESIS_POLL_MS = 12 * 1000;

export async function waitForGenesis(apiClient: IApiClient, logger: ILogger, signal?: AbortSignal): Promise<Genesis> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await apiClient.beacon.getGenesis();
    } catch (e) {
      // TODO: Search for a 404 error which indicates that genesis has not yet occurred.
      // Note: Lodestar API does not become online after genesis is found
      logger.info("Waiting for genesis", {message: (e as Error).message});
      await sleep(WAITING_FOR_GENESIS_POLL_MS, signal);
    }
  }
}
