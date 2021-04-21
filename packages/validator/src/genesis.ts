import {AbortSignal} from "abort-controller";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Genesis} from "@chainsafe/lodestar-types/phase0";
import {ILogger, sleep} from "@chainsafe/lodestar-utils";
import {IApiClient} from "./api";
import {ApiClientOverRest} from "./api/rest";
import {IValidatorOptions} from "./options";

/** The time between polls when waiting for genesis */
const WAITING_FOR_GENESIS_POLL_MS = 12 * 1000;

/** Start validator client N epochs before genesis */
const START_BEFORE_GENESIS_EPOCHS = 1;

export async function waitForGenesisAndGenesisTime(
  opts: Pick<IValidatorOptions, "config" | "logger" | "api">,
  signal?: AbortSignal
): Promise<Genesis> {
  const apiClient = typeof opts.api === "string" ? ApiClientOverRest(opts.config, opts.api) : opts.api;

  opts.logger.info("RPC connection successfully established");

  // Wait for genesis to be available
  const genesis = await waitForGenesis(apiClient, opts.logger, signal);
  opts.logger.info("Genesis available");

  // Wait for genesisTime
  await waitForGenesisTime(genesis, opts.logger, opts.config, signal);
  opts.logger.info("Chain has started");

  // TODO: Wait for synced beacon chain

  return genesis;
}

async function waitForGenesis(apiClient: IApiClient, logger: ILogger, signal?: AbortSignal): Promise<Genesis> {
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

async function waitForGenesisTime(
  genesis: Genesis,
  logger: ILogger,
  config: IBeaconConfig,
  signal?: AbortSignal
): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const secToGenesis = Number(genesis.genesisTime) - Math.floor(Date.now() / 1000);
    if (secToGenesis < START_BEFORE_GENESIS_EPOCHS * config.params.SLOTS_PER_EPOCH * config.params.SECONDS_PER_SLOT) {
      return; // Start!
    }

    logger.info("Waiting for genesis time", {secToGenesis});
    await sleep(Math.max(secToGenesis, 60) * 1000, signal); // Log every 1 min max
  }
}
