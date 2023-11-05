import {LogLevel, Logger} from "@lodestar/utils";
import {GlobalArgs} from "../../options/index.js";
import {IValidatorCliArgs} from "./options.js";

/**
 * Log beacon node urls
 */
export function logArguments(logger: Pick<Logger, LogLevel.info>, args: IValidatorCliArgs & GlobalArgs): void {
  const beaconNodes = args["beaconNodes"];

  if (beaconNodes?.length > 0) {
    logger.info(`${beaconNodes.length} beacon nodes`);
    beaconNodes.forEach((url, index) => {
      logger.info(`Beacon node url ${index + 1}: ${url}`);
    });
  }
}
