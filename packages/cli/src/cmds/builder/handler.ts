import fs from "node:fs";
import path from "node:path";
import {getClient} from "@lodestar/api";
import {
  ExecutionEngineError,
  ExecutionEngineErrorCode,
  ExecutionPayloadStatus,
  RegistryMetricCreator,
  collectNodeJSMetrics,
  defaultExecutionEngineHttpOpts,
  getHttpMetricsServer,
  initializeExecutionEngine,
} from "@lodestar/beacon-node";
import {Builder, EnginePayloadResult, EnginePayloadSource, ProportionalBidPolicy, getMetrics} from "@lodestar/builder";
import {ChainForkConfig} from "@lodestar/config";
import {getNodeLogger} from "@lodestar/logger/node";
import {ForkName} from "@lodestar/params";
import {fromHex, toPrintableUrl} from "@lodestar/utils";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {GlobalArgs} from "../../options/index.js";
import {getGlobalPaths} from "../../paths/global.js";
import {
  YargsError,
  cleanOldLogFiles,
  extractJwtHexSecret,
  onGracefulShutdown,
  parseFeeRecipient,
  parseLoggerArgs,
} from "../../util/index.js";
import {getVersionData} from "../../util/version.js";
import {loadBuilderKeypair} from "./loadKeypair.js";
import {IBuilderCliArgs, builderMetricsDefaultOptions} from "./options.js";

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

  // Before the keystore is loaded and the builder waits for genesis, the fork and its activation
  validateBiddingArgs(args, config);

  const keypair = await loadBuilderKeypair(logger, args.keystore, args.keystorePassword, args.builderPubkey);

  const onGracefulShutdownCbs: (() => Promise<void> | void)[] = [];
  onGracefulShutdown(async () => {
    for (const cb of onGracefulShutdownCbs) await cb();
  }, logger.info.bind(logger));

  const abortController = new AbortController();
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

  // Payload ids are local to the execution client that issued them, fallback urls can't be used
  if (args["execution.urls"].length !== 1) {
    throw Error("Exactly one execution client url is required");
  }
  const executionUrl = args["execution.urls"][0];
  const engine = initializeExecutionEngine(
    {
      mode: "http",
      urls: [executionUrl],
      timeout: args["execution.timeout"] ?? defaultExecutionEngineHttpOpts.timeout,
      retries: args["execution.retries"],
      retryDelay: args["execution.retryDelay"],
      jwtSecretHex: args["execution.jwtSecret"]
        ? extractJwtHexSecret(fs.readFileSync(args["execution.jwtSecret"], "utf-8").trim())
        : undefined,
      version,
      commit,
    },
    {signal: abortController.signal, logger}
  );
  const payloadSource = new EnginePayloadSource(toPrintableUrl(executionUrl), {
    notifyForkchoiceUpdate: async (
      fork,
      headBlockHash,
      safeBlockHash,
      finalizedBlockHash,
      payloadAttributes,
      _custodyColumns,
      signal
    ) => {
      try {
        const {payloadStatus, payloadId} = await engine.notifyForkchoiceUpdate(
          fork,
          headBlockHash,
          safeBlockHash,
          finalizedBlockHash,
          payloadAttributes,
          signal
        );
        if (payloadStatus.status === ExecutionPayloadStatus.INVALID) {
          throw Error(`Invalid prepare payload, validationError=${payloadStatus.validationError ?? ""}`);
        }
        return payloadId;
      } catch (e) {
        // Only retry while the execution client is syncing, it has not imported the parent payload yet
        if (e instanceof ExecutionEngineError && e.type.code === ExecutionEngineErrorCode.SYNCING) return null;
        throw e;
      }
    },
    getPayload: async (fork, payloadId, signal) =>
      (await engine.getPayload(fork, payloadId, signal)) as EnginePayloadResult,
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

  onGracefulShutdownCbs.push(() => builder.close());
}

/**
 * The bidding and reveal options are only used once the builder is active and builds for a slot, an invalid value
 * would otherwise show as a builder that never bids or reveals.
 */
function validateBiddingArgs(args: IBuilderCliArgs, config: ChainForkConfig): void {
  for (const [option, value] of [
    ["bidding.deadlineBps", args["bidding.deadlineBps"]],
    ["reveal.cutoffBps", args["reveal.cutoffBps"] ?? config.PAYLOAD_ATTESTATION_DUE_BPS],
  ] as const) {
    // A point within a slot, the bid deadline at the slot boundaries leaves no time to build or to select the bid
    if (!Number.isSafeInteger(value) || value <= 0 || value >= 10_000) {
      throw new YargsError(`Invalid ${option}=${value}, must be an integer within (0, 10000)`);
    }
  }

  const getPayloadTimeout = args["bidding.getPayloadTimeout"];
  const slotDurationMs = config.getSlotDurationMs(ForkName.gloas);
  if (!Number.isSafeInteger(getPayloadTimeout) || getPayloadTimeout <= 0 || getPayloadTimeout > slotDurationMs) {
    throw new YargsError(
      `Invalid bidding.getPayloadTimeout=${getPayloadTimeout}, must be a positive integer not above the slot duration of ${slotDurationMs} ms`
    );
  }

  const minOperatingBalanceGwei = args["bidding.minOperatingBalanceGwei"];
  if (!Number.isSafeInteger(minOperatingBalanceGwei) || minOperatingBalanceGwei < 0) {
    throw new YargsError(
      `Invalid bidding.minOperatingBalanceGwei=${minOperatingBalanceGwei}, must be a non-negative safe integer`
    );
  }

  try {
    new ProportionalBidPolicy({
      shareBps: args["bidding.shareBps"],
      fixedCostGwei: args["bidding.fixedCostGwei"],
      minValueGwei: args["bidding.minValueGwei"],
      maxValueGwei: args["bidding.maxValueGwei"],
    });
  } catch (e) {
    throw new YargsError(`Invalid bidding options: ${(e as Error).message}`);
  }
}
