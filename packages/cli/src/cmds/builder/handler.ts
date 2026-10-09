import path from "node:path";
import {getClient} from "@lodestar/api";
import {RegistryMetricCreator, collectNodeJSMetrics, getHttpMetricsServer} from "@lodestar/beacon-node";
import {Builder, getMetrics} from "@lodestar/builder";
import {getNodeLogger} from "@lodestar/logger/node";
import {fromHex, toPrintableUrl} from "@lodestar/utils";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {GlobalArgs} from "../../options/index.js";
import {getGlobalPaths} from "../../paths/global.js";
import {cleanOldLogFiles, onGracefulShutdown, parseFeeRecipient, parseLoggerArgs} from "../../util/index.js";
import {getVersionData} from "../../util/version.js";
import {loadBuilderKeypair} from "./loadKeypair.js";
import {IBuilderCliArgs, builderMetricsDefaultOptions} from "./options.js";
import {getBuilderBidOptions} from "./runtime.js";

const ZERO_ADDRESS = "0x" + "0".repeat(40);

export async function builderHandler(args: IBuilderCliArgs & GlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);

  if (config.GLOAS_FORK_EPOCH === Infinity) {
    throw Error(`Gloas must be scheduled via GLOAS_FORK_EPOCH for network=${network}`);
  }

  const globalPaths = getGlobalPaths(args, network);
  const defaultLogFilepath = path.join(globalPaths.dataDir, "builder.log");
  const logger = getNodeLogger(parseLoggerArgs(args, {defaultLogFilepath}, config));

  try {
    cleanOldLogFiles(args, {defaultLogFilepath});
  } catch (e) {
    logger.debug("Not able to delete log files", {}, e as Error);
  }

  const {version, commit} = getVersionData();
  logger.info("Lodestar", {network, version, commit});

  const executionFeeRecipient = parseFeeRecipient(args.executionFeeRecipient);

  if (executionFeeRecipient === ZERO_ADDRESS) {
    throw Error("Cannot put zero address as an executionFeeRecipient");
  }

  const abortController = new AbortController();
  const bidRuntime = getBuilderBidOptions(args, config, abortController.signal, logger);

  const keypair = await loadBuilderKeypair(logger, args.keystore, args.keystorePassword, args.builderPubkey);

  const onGracefulShutdownCbs: (() => Promise<void> | void)[] = [];
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= (async () => {
      for (const cb of onGracefulShutdownCbs) {
        try {
          await cb();
        } catch (error) {
          logger.error("Failed to shut down Builder resource", {}, error as Error);
        }
      }
    })();
    return shutdownPromise;
  };
  onGracefulShutdown(shutdown, logger.info.bind(logger));

  onGracefulShutdownCbs.push(async () => abortController.abort());

  const register = args.metrics ? new RegistryMetricCreator() : null;
  const metrics = register && getMetrics(register, {version, commit, network});

  if (metrics) {
    const closeMetrics = collectNodeJSMetrics(register);
    onGracefulShutdownCbs.push(() => closeMetrics());

    const port = args["metrics.port"] ?? builderMetricsDefaultOptions.port;
    const address = args["metrics.address"] ?? builderMetricsDefaultOptions.address;
    const metricsServer = await getHttpMetricsServer({port, address}, {register, logger});

    onGracefulShutdownCbs.push(() => metricsServer.close());
  }

  const api = getClient(
    {urls: [args.beaconNodeUrl], globalInit: {signal: abortController.signal, timeoutMs: args.requestTimeout}},
    {config, logger, metrics: metrics?.restApiClient}
  );

  logger.info("Beacon node", {beaconNode: toPrintableUrl(args.beaconNodeUrl), timeoutMs: args.requestTimeout});
  if (bidRuntime) {
    logger.info("Builder bidding enabled", {
      executionUrl: toPrintableUrl(args["execution.url"] ?? ""),
      getPayloadAtBps: bidRuntime.inputs.deadlineBps,
      getPayloadTimeout: bidRuntime.orchestration.getPayloadTimeout,
      revealCutoffBps: bidRuntime.reveal.cutoffBps,
      minOperatingBalanceGwei: bidRuntime.minOperatingBalanceGwei,
    });
  }

  const builder = await Builder.init({
    keypair,
    logger,
    config,
    abortController,
    api,
    executionFeeRecipient: fromHex(executionFeeRecipient),
    metrics,
    bidRuntime,
  }).catch(async (error: unknown) => {
    await shutdown();
    throw error;
  });

  if (abortController.signal.aborted) {
    await builder.close();
  } else {
    onGracefulShutdownCbs.push(() => builder.close());
  }
}
