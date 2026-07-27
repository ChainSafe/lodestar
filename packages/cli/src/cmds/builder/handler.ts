import path from "node:path";
import {getClient} from "@lodestar/api";
import {Builder} from "@lodestar/builder";
import {getNodeLogger} from "@lodestar/logger/node";
import {waitForGenesis} from "@lodestar/validator";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {GlobalArgs} from "../../options/index.js";
import {getGlobalPaths} from "../../paths/global.js";
import {cleanOldLogFiles, onGracefulShutdown, parseLoggerArgs} from "../../util/index.js";
import {IBuilderCliArgs} from "./options.js";
import {loadBuilderSigner} from "./signer.js";

export async function builderHandler(args: IBuilderCliArgs & GlobalArgs): Promise<void> {
  const abortController = new AbortController();

  const {config, network} = getBeaconConfigFromArgs(args);

  const globalPaths = getGlobalPaths(args, network);
  const defaultLogFilepath = path.join(globalPaths.dataDir, "builder.log");
  const logger = getNodeLogger(parseLoggerArgs(args, {defaultLogFilepath}, config));

  try {
    cleanOldLogFiles(args, {defaultLogFilepath});
  } catch (e) {
    logger.debug("Not able to delete log files", {}, e as Error);
  }

  const secretKey = await loadBuilderSigner(args.keystore, args.keystorePassword, args.builderPubkey);

  onGracefulShutdown(async () => {
    abortController.abort();
  }, logger.info.bind(logger));

  const api = getClient({urls: [args.beaconNodeUrl], globalInit: {signal: abortController.signal}}, {config, logger});

  const genesis = await waitForGenesis(api, logger, abortController.signal);

  const _builder = Builder.init(
    {
      secretKey,
      logger,
      config,
      abortController,
      api,
    },
    genesis
  );
}
