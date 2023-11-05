import {LogLevel, Logger} from "@lodestar/utils";
import {GlobalArgs} from "../../options/index.js";
import {BeaconArgs} from "./options.js";

/**
 * Log urls from CLI arguments for execution.urls, eth1.providerUrls and builder.urls
 */
export function logArguments(logger: Pick<Logger, LogLevel.info>, args: BeaconArgs & GlobalArgs): void {
  const executionUrls = args["execution.urls"];

  if (executionUrls?.length > 0) {
    logger.info(`Total execution urls: ${executionUrls.length}`);
    executionUrls.forEach((url, index) => {
      logger.info(`Execution url (${index + 1}): ${url}`);
    });
  }

  const eth1ProviderUrls = args["eth1.providerUrls"];

  if (eth1ProviderUrls && eth1ProviderUrls?.length > 0) {
    logger.info(`Total eth1 provider urls: ${eth1ProviderUrls.length}`);
    eth1ProviderUrls.forEach((url, index) => {
      logger.info(`Eth1 provider url (${index + 1}): ${url}`);
    });
  }

  const builderUrls = args["builder.urls"];

  if (builderUrls && builderUrls?.length > 0) {
    logger.info(`Total builder url(s): ${builderUrls.length}`);
    builderUrls.forEach((url, index) => {
      logger.info(`Builder url (${index + 1}): ${url}`);
    });
  }
}
