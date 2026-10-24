import fs from "node:fs";
import path from "node:path";
import {getClient} from "@lodestar/api";
import {
  RegistryMetricCreator,
  collectNodeJSMetrics,
  defaultExecutionEngineHttpOpts,
  getHttpMetricsServer,
} from "@lodestar/beacon-node";
import {Builder, EnginePayloadSource, ProportionalBidPolicy, getMetrics} from "@lodestar/builder";
import {getNodeLogger} from "@lodestar/logger/node";
import {ForkName} from "@lodestar/params";
import {fromHex, isValidHttpUrl, toPrintableUrl} from "@lodestar/utils";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {GlobalArgs} from "../../options/index.js";
import {getGlobalPaths} from "../../paths/global.js";
import {YargsError} from "../../util/errors.js";
import {
  cleanOldLogFiles,
  extractJwtHexSecret,
  onGracefulShutdown,
  parseFeeRecipient,
  parseLoggerArgs,
} from "../../util/index.js";
import {getVersionData} from "../../util/version.js";
import {createPayloadSourceEngine} from "./engine.js";
import {loadBuilderKeypair} from "./loadKeypair.js";
import {IBuilderCliArgs, builderMetricsDefaultOptions} from "./options.js";

const ZERO_ADDRESS = "0x" + "0".repeat(40);

export async function builderHandler(args: IBuilderCliArgs & GlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);

  if (config.GLOAS_FORK_EPOCH === Infinity) {
    throw new YargsError(`Gloas must be scheduled via GLOAS_FORK_EPOCH for network=${network}`);
  }

  if (args["execution.urls"].length !== 1) {
    throw new YargsError("Exactly one execution.urls entry is required; payload IDs are local to that Engine");
  }
  const executionUrl = args["execution.urls"][0];
  if (!isValidHttpUrl(executionUrl)) throw new YargsError("execution.urls must contain an HTTP or HTTPS URL");
  for (const [option, value] of [
    ["bidding.deadlineBps", args["bidding.deadlineBps"]],
    ["reveal.cutoffBps", args["reveal.cutoffBps"] ?? config.PAYLOAD_ATTESTATION_DUE_BPS],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0 || value >= 10_000) {
      throw new YargsError(`${option} must be an integer within (0, 10000)`);
    }
  }
  for (const [option, value] of [
    ["execution.timeout", args["execution.timeout"] ?? defaultExecutionEngineHttpOpts.timeout],
    ["bidding.getPayloadTimeout", args["bidding.getPayloadTimeout"]],
  ] as const) {
    if (value === undefined || !Number.isSafeInteger(value) || value <= 0 || value > 2 ** 31 - 1) {
      throw new YargsError(`${option} must be a positive integer within the supported timer range`);
    }
  }
  if (args["bidding.getPayloadTimeout"] > config.getSlotDurationMs(ForkName.gloas)) {
    throw new YargsError("bidding.getPayloadTimeout must not exceed the Gloas slot duration");
  }
  for (const [option, value] of [
    ["execution.retries", args["execution.retries"]],
    ["execution.retryDelay", args["execution.retryDelay"]],
    ["bidding.minOperatingBalanceGwei", args["bidding.minOperatingBalanceGwei"]],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new YargsError(`${option} must be a non-negative safe integer`);
    }
  }
  if (args["execution.retryDelay"] > 2 ** 31 - 1) {
    throw new YargsError("execution.retryDelay exceeds the supported timer range");
  }
  try {
    new ProportionalBidPolicy({
      shareBps: args["bidding.shareBps"],
      fixedCostGwei: args["bidding.fixedCostGwei"],
      minValueGwei: args["bidding.minValueGwei"],
      maxValueGwei: args["bidding.maxValueGwei"],
    });
  } catch (error) {
    throw new YargsError(`Invalid bidding policy options: ${(error as Error).message}`);
  }
  let jwtSecret: Uint8Array | undefined;
  if (args["execution.jwtSecret"]) {
    try {
      jwtSecret = fromHex(extractJwtHexSecret(fs.readFileSync(args["execution.jwtSecret"], "utf8").trim()));
    } catch {
      throw new YargsError("Unable to read execution.jwtSecret. Expected a 256-bit hex JWT secret");
    }
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
    throw new YargsError("Cannot put zero address as an executionFeeRecipient");
  }

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

  const abortController = new AbortController();
  onGracefulShutdownCbs.push(async () => abortController.abort());

  try {
    const register = args.metrics ? new RegistryMetricCreator() : null;
    const metrics = register && getMetrics(register, {version, commit, network});

    if (metrics) {
      const closeMetrics = collectNodeJSMetrics(register);
      onGracefulShutdownCbs.push(() => closeMetrics());

      const port = args["metrics.port"] ?? builderMetricsDefaultOptions.port;
      const address = args["metrics.address"] ?? builderMetricsDefaultOptions.address;
      const metricsServer = await getHttpMetricsServer({port, address}, {register, logger});
      if (abortController.signal.aborted) {
        await metricsServer.close();
        abortController.signal.throwIfAborted();
      }
      onGracefulShutdownCbs.push(() => metricsServer.close());
    }

    const api = getClient(
      {urls: [args.beaconNodeUrl], globalInit: {signal: abortController.signal, timeoutMs: args.requestTimeout}},
      {config, logger, metrics: metrics?.restApiClient}
    );

    logger.info("Beacon node", {beaconNode: toPrintableUrl(args.beaconNodeUrl), timeoutMs: args.requestTimeout});

    const engine = createPayloadSourceEngine({
      url: executionUrl,
      timeout: args["execution.timeout"] ?? defaultExecutionEngineHttpOpts.timeout,
      retries: args["execution.retries"],
      retryDelay: args["execution.retryDelay"],
      jwtSecret,
      version,
      commit,
      signal: abortController.signal,
      logger,
    });
    const payloadSource = new EnginePayloadSource(toPrintableUrl(executionUrl), engine);

    logger.info("Bidding requires per-slot payload attributes from the source BN", {
      lodestarOption: "--emitPayloadAttributes",
    });

    const builder = await Builder.init({
      keypair,
      logger,
      config,
      abortController,
      api,
      executionFeeRecipient: fromHex(executionFeeRecipient),
      metrics,
      payloadSource,
      bidding: {
        shareBps: args["bidding.shareBps"],
        fixedCostGwei: args["bidding.fixedCostGwei"],
        minValueGwei: args["bidding.minValueGwei"],
        maxValueGwei: args["bidding.maxValueGwei"],
        deadlineBps: args["bidding.deadlineBps"],
        getPayloadTimeout: args["bidding.getPayloadTimeout"],
        minOperatingBalanceGwei: args["bidding.minOperatingBalanceGwei"],
      },
      reveal: {cutoffBps: args["reveal.cutoffBps"]},
    });

    if (abortController.signal.aborted) {
      await builder.close();
    } else {
      onGracefulShutdownCbs.push(() => builder.close());
    }
  } catch (error) {
    await shutdown();
    throw error;
  }
}
