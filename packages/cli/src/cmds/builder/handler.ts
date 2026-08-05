import path from "node:path";
import {getClient} from "@lodestar/api";
import {Builder} from "@lodestar/builder";
import {getNodeLogger} from "@lodestar/logger/node";
import {fromHex} from "@lodestar/utils";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {GlobalArgs} from "../../options/index.js";
import {getGlobalPaths} from "../../paths/global.js";
import {cleanOldLogFiles, onGracefulShutdown, parseFeeRecipient, parseLoggerArgs} from "../../util/index.js";
import {loadBuilderKeypair} from "./loadKeypair.js";
import {IBuilderCliArgs} from "./options.js";

export async function builderHandler(args: IBuilderCliArgs & GlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);

  const globalPaths = getGlobalPaths(args, network);
  const defaultLogFilepath = path.join(globalPaths.dataDir, "builder.log");
  const logger = getNodeLogger(parseLoggerArgs(args, {defaultLogFilepath}, config));

  try {
    cleanOldLogFiles(args, {defaultLogFilepath});
  } catch (e) {
    logger.debug("Not able to delete log files", {}, e as Error);
  }

  const executionFeeRecipient = parseFeeRecipient(args.executionFeeRecipient);

  if (executionFeeRecipient === "0x" + "0".repeat(40)) {
    throw Error("Cannot put zero address as an executionFeeRecipient");
  }

  const keypair = await loadBuilderKeypair(args.keystore, args.keystorePassword, args.builderPubkey);

  const onGracefulShutdownCbs: (() => Promise<void> | void)[] = [];
  onGracefulShutdown(async () => {
    for (const cb of onGracefulShutdownCbs) await cb();
  }, logger.info.bind(logger));

  const abortController = new AbortController();
  onGracefulShutdownCbs.push(async () => abortController.abort());

  const api = getClient({urls: [args.beaconNodeUrl], globalInit: {signal: abortController.signal}}, {config, logger});

  const builder = await Builder.init({
    keypair,
    logger,
    config,
    abortController,
    api,
    executionFeeRecipient: fromHex(executionFeeRecipient),
  });

  onGracefulShutdownCbs.push(() => builder.close());
}
