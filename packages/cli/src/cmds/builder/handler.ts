import fs from "node:fs";
import path from "node:path";
import {getClient} from "@lodestar/api";
import {
  JsonRpcHttpClient,
  RegistryMetricCreator,
  collectNodeJSMetrics,
  getHttpMetricsServer,
  initializeExecutionEngine,
} from "@lodestar/beacon-node";
import {
  Builder,
  EnginePayloadResult,
  EnginePayloadSource,
  MAX_ADDITIONAL_PROPOSER_PREFERENCES_SOURCES,
  MAX_BID_REVISIONS_PER_SLOT,
  type PayloadSource,
  getMetrics,
  validateHttpBidResponseTiming,
} from "@lodestar/builder";
import {getNodeLogger} from "@lodestar/logger/node";
import {fromHex, isValidHttpUrl, toPrintableUrl} from "@lodestar/utils";
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
import {BuilderRestApiServer, getBuilderApiBeforeInit} from "./apiServer.js";
import {ForkTransitionPayloadSource} from "./forkTransitionPayloadSource.js";
import {loadGossipIdentities} from "./gossipIdentities.js";
import {loadBuilderKeypair} from "./loadKeypair.js";
import {IBuilderCliArgs, builderMetricsDefaultOptions} from "./options.js";
import {SessionPayloadSource} from "./sessionPayloadSource.js";
import {TestingPayloadSource} from "./testingPayloadSource.js";

const ZERO_ADDRESS = "0x" + "0".repeat(40);
const FORK_TRANSITION_SNAPSHOT_MARGIN_MS = 300;

export async function builderHandler(args: IBuilderCliArgs & GlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);

  if (config.GLOAS_FORK_EPOCH === Infinity) {
    throw Error(`Gloas must be scheduled via GLOAS_FORK_EPOCH for network=${network}`);
  }

  const assumedIdentity = parseAssumedIdentity(args.assumeBuilderIndex, args.assumeBuilderBalanceGwei);
  const transactionsFile = args["payload.transactionsFile"];
  const testingUrl = args["payload.testingUrl"];
  const constructorUrl = args["payload.constructorUrl"];
  const engineUntilSlot = args["payload.engineUntilSlot"];
  if (
    engineUntilSlot !== undefined &&
    (!constructorUrl || !Number.isSafeInteger(engineUntilSlot) || engineUntilSlot < 0)
  ) {
    throw new YargsError("--payload.engineUntilSlot requires --payload.constructorUrl and a non-negative safe slot");
  }
  if (
    engineUntilSlot !== undefined &&
    (!Number.isSafeInteger(args["bidding.deadlineBps"]) ||
      args["bidding.deadlineBps"] <= 0 ||
      args["bidding.deadlineBps"] > 10000)
  ) {
    throw new YargsError("--payload.engineUntilSlot requires --bidding.deadlineBps between 1 and 10000");
  }
  if (constructorUrl && (transactionsFile || testingUrl || args["payload.outputDir"])) {
    throw new YargsError("--payload.constructorUrl cannot be combined with controlled transaction file options");
  }
  if (!transactionsFile && (testingUrl || args["payload.outputDir"] || (args["payload.dryRun"] && !constructorUrl))) {
    throw new YargsError("--payload.transactionsFile is required for controlled payload options");
  }
  if (transactionsFile && !testingUrl) {
    throw new YargsError("--payload.transactionsFile requires --payload.testingUrl");
  }
  if (args["payload.dryRun"] && !constructorUrl && !args["payload.outputDir"]) {
    throw new YargsError("--payload.dryRun requires --payload.outputDir");
  }
  const updateIntervalMs = args["bidding.updateIntervalMs"];
  const updateCutoffBps = args["bidding.updateCutoffBps"];
  const maxRevisionsPerSlot = args["bidding.maxRevisionsPerSlot"];
  const alternateBranches = args["bidding.alternateBranches"] ?? false;
  const alternateGossip = args["bidding.alternateGossip"] ?? false;
  const beginReservations = args["payload.beginReservations"] ?? false;
  const retainedAlternateOffers = args["payload.alternateOrderGenerations"] ?? false;
  const primaryHandoff = args["bidding.primaryHandoff"] ?? false;
  if (alternateGossip && (!alternateBranches || !retainedAlternateOffers)) {
    throw new YargsError(
      "--bidding.alternateGossip requires --bidding.alternateBranches and --payload.alternateOrderGenerations"
    );
  }
  if (primaryHandoff && (!alternateBranches || !retainedAlternateOffers)) {
    throw new YargsError(
      "--bidding.primaryHandoff requires --bidding.alternateBranches and --payload.alternateOrderGenerations"
    );
  }
  if (retainedAlternateOffers && (!constructorUrl || !alternateBranches || updateIntervalMs === 0)) {
    throw new YargsError(
      "--payload.alternateOrderGenerations requires --payload.constructorUrl, --bidding.alternateBranches and payload updates"
    );
  }
  if (beginReservations && !constructorUrl) {
    throw new YargsError("--payload.beginReservations requires --payload.constructorUrl");
  }
  const alternateBuildDurationMs = args["bidding.alternateBuildDurationMs"] ?? 500;
  const alternateRefreshBeforeSlotMs = args["bidding.alternateRefreshBeforeSlotMs"] ?? 0;
  const httpTiming = {
    httpReturnReserveCapMs: args["builderApi.httpReturnReserveCapMs"],
    httpResponseMarginMs: args["builderApi.httpResponseMarginMs"],
  };
  if (Object.values(httpTiming).some((value) => value !== undefined) && !args.builderApi) {
    throw new YargsError("HTTP bid response timing options require --builderApi");
  }
  validateHttpBidResponseTiming(httpTiming);
  if (
    args["builderApi.bidStreamAdaptiveTiming"] === true &&
    (args.builderApi !== true || args["builderApi.bidStream"] !== true)
  ) {
    throw new YargsError("--builderApi.bidStreamAdaptiveTiming requires --builderApi and --builderApi.bidStream");
  }
  if (
    !Number.isSafeInteger(updateIntervalMs) ||
    (updateIntervalMs !== 0 && (updateIntervalMs < 25 || !constructorUrl))
  ) {
    throw new YargsError("Payload updates require --payload.constructorUrl and an interval of at least 25 ms");
  }
  if (!Number.isSafeInteger(updateCutoffBps) || updateCutoffBps < 0 || updateCutoffBps > 10000) {
    throw new YargsError("--bidding.updateCutoffBps must be between 0 and 10000");
  }
  if (
    !Number.isSafeInteger(maxRevisionsPerSlot) ||
    maxRevisionsPerSlot < 1 ||
    maxRevisionsPerSlot > MAX_BID_REVISIONS_PER_SLOT
  ) {
    throw new YargsError(`--bidding.maxRevisionsPerSlot must be between 1 and ${MAX_BID_REVISIONS_PER_SLOT}`);
  }
  if (alternateBranches && (!constructorUrl || updateIntervalMs === 0)) {
    throw new YargsError("Alternate branches require --payload.constructorUrl and payload updates");
  }
  if (
    !Number.isSafeInteger(alternateBuildDurationMs) ||
    alternateBuildDurationMs < 250 ||
    alternateBuildDurationMs > 1000
  ) {
    throw new YargsError("--bidding.alternateBuildDurationMs must be between 250 and 1000");
  }
  if (
    !Number.isSafeInteger(alternateRefreshBeforeSlotMs) ||
    (alternateRefreshBeforeSlotMs !== 0 && (alternateRefreshBeforeSlotMs < 500 || alternateRefreshBeforeSlotMs > 5000))
  ) {
    throw new YargsError("--bidding.alternateRefreshBeforeSlotMs must be zero or between 500 and 5000");
  }
  if (alternateRefreshBeforeSlotMs > 0 && !alternateBranches) {
    throw new YargsError("--bidding.alternateRefreshBeforeSlotMs requires --bidding.alternateBranches");
  }
  const proposerPreferencesUrls = parseProposerPreferencesUrls(
    args["proposerPreferences.urls"] ?? [],
    args.beaconNodeUrl
  );
  const proposerPreferencesTimeout = args["proposerPreferences.timeout"];
  if (!Number.isSafeInteger(proposerPreferencesTimeout) || proposerPreferencesTimeout < 100) {
    throw new YargsError("--proposerPreferences.timeout must be at least 100 ms");
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

  const keypair = await loadBuilderKeypair(logger, args.keystore, args.keystorePassword, args.builderPubkey);

  const gossipIdentities = await loadGossipIdentities(logger, args["bidding.gossipIdentitiesFile"]);

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

  const proposerPreferencesSources = proposerPreferencesUrls.map((url) => ({
    id: toPrintableUrl(url),
    api: getClient(
      {urls: [url], globalInit: {signal: abortController.signal, timeoutMs: proposerPreferencesTimeout}},
      {config, logger, metrics: metrics?.restApiClient}
    ),
  }));
  if (proposerPreferencesSources.length > 0) {
    logger.info("Proposer preferences sources", {
      beaconNodes: proposerPreferencesSources.map(({id}) => id).join(","),
      timeoutMs: proposerPreferencesTimeout,
    });
  }

  const createEngineSource = (): EnginePayloadSource => {
    // Payload ids are local to the execution client that issued them, fallback urls can't be used
    if (args["execution.urls"].length !== 1) {
      throw Error("Exactly one execution client url is required");
    }
    const executionUrl = args["execution.urls"][0];
    const engine = initializeExecutionEngine(
      {
        mode: "http",
        urls: [executionUrl],
        timeout: args["execution.timeout"],
        retries: args["execution.retries"],
        retryDelay: args["execution.retryDelay"],
        jwtSecretHex: args.jwtSecret ? extractJwtHexSecret(fs.readFileSync(args.jwtSecret, "utf-8").trim()) : undefined,
        jwtId: args.jwtId,
        version,
        commit,
      },
      {signal: abortController.signal, logger}
    );
    return new EnginePayloadSource(toPrintableUrl(executionUrl), {
      notifyForkchoiceUpdate: async (fork, headBlockHash, safeBlockHash, finalizedBlockHash, payloadAttributes) =>
        (await engine.notifyForkchoiceUpdate(fork, headBlockHash, safeBlockHash, finalizedBlockHash, payloadAttributes))
          .payloadId,
      getPayload: async (fork, payloadId) => (await engine.getPayload(fork, payloadId)) as EnginePayloadResult,
    });
  };

  let payloadSource: PayloadSource;
  if (constructorUrl) {
    payloadSource = new SessionPayloadSource(
      toPrintableUrl(constructorUrl),
      (signal) =>
        new JsonRpcHttpClient([constructorUrl], {
          signal,
          timeout: args["execution.timeout"],
        }),
      {boundedAlternates: alternateBranches, beginReservations, retainedAlternateOffers, primaryHandoff, logger}
    );
    if (engineUntilSlot !== undefined) {
      payloadSource = new ForkTransitionPayloadSource(
        payloadSource,
        createEngineSource(),
        engineUntilSlot,
        config.getSlotDurationMs(config.getForkName(engineUntilSlot)) -
          config.getSlotComponentDurationMs(config.getForkName(engineUntilSlot), args["bidding.deadlineBps"]) +
          FORK_TRANSITION_SNAPSHOT_MARGIN_MS
      );
      logger.info("Execution client builds through the configured fork transition slot", {engineUntilSlot});
    }
    logger.info("Session payload source", {
      url: toPrintableUrl(constructorUrl),
      updateIntervalMs,
      updateCutoffBps,
      maxRevisionsPerSlot,
      alternateBranches,
      alternateGossip,
      primaryHandoff,
      alternateBuildDurationMs,
      alternateRefreshBeforeSlotMs,
      dryRun: args["payload.dryRun"],
    });
  } else if (transactionsFile && testingUrl) {
    const rpc = new JsonRpcHttpClient([testingUrl], {
      signal: abortController.signal,
      timeout: args["execution.timeout"],
    });
    payloadSource = new TestingPayloadSource(toPrintableUrl(testingUrl), rpc, {
      transactionsFile,
      outputDir: args["payload.outputDir"],
    });
    logger.info("Controlled payload source", {
      url: toPrintableUrl(testingUrl),
      transactionsFile,
      dryRun: args["payload.dryRun"],
    });
  } else {
    payloadSource = createEngineSource();
  }

  const builderApiOpts = args.builderApi ? {authData: getBuilderApiAuthData(args), ...httpTiming} : undefined;

  // The builder is only initialized once it is active, which can take until after the fork. The builder
  // API is served before that, so proposers can already reach it
  let builder: Builder | null = null;
  if (builderApiOpts !== undefined) {
    const builderApiServer = new BuilderRestApiServer(
      {
        address: args["builderApi.address"],
        port: args["builderApi.port"],
        bidStream: args["builderApi.bidStream"],
        bidStreamAdaptiveTiming: args["builderApi.bidStreamAdaptiveTiming"],
        orderExposureTokenFile: args["builderApi.orderExposureTokenFile"],
      },
      {
        config,
        logger,
        api: getBuilderApiBeforeInit(config, () => builder?.builderApi ?? null),
        getBidStreamApi: () => builder?.builderBidStreamApi ?? null,
        getOrderExposure: () => builder?.orderExposure ?? null,
        metrics: null,
      }
    );
    onGracefulShutdownCbs.push(() => builderApiServer.close());
    await builderApiServer.listen();
  }

  builder = await Builder.init({
    keypair,
    gossipIdentities,
    logger,
    config,
    abortController,
    api,
    executionFeeRecipient: fromHex(executionFeeRecipient),
    metrics,
    payloadSource,
    commitmentDir: args["payload.dryRun"] ? undefined : path.join(globalPaths.dataDir, "builder-commitments"),
    bidding: {
      dryRun: args["payload.dryRun"],
      shareBps: args["bidding.shareBps"],
      fixedCostGwei: args["bidding.fixedCostGwei"],
      subsidyGwei: args["bidding.subsidyGwei"],
      subsidyUntilSlot: args["bidding.subsidyUntilSlot"],
      minValueGwei: args["bidding.minValueGwei"],
      maxValueGwei: args["bidding.maxValueGwei"],
      deadlineBps: args["bidding.deadlineBps"],
      getPayloadTimeout: args["bidding.getPayloadTimeout"],
      updateIntervalMs,
      updateCutoffBps,
      maxRevisionsPerSlot,
      alternateBranches,
      alternateGossip,
      primaryHandoff,
      alternateBuildDurationMs,
      alternateRefreshBeforeSlotMs,
      deferUnusedGossipStages: args["bidding.deferUnusedGossipStages"],
      minOperatingBalanceGwei: args["bidding.minOperatingBalanceGwei"],
    },
    builderApi: builderApiOpts,
    proposerPreferences: {sources: proposerPreferencesSources, timeoutMs: proposerPreferencesTimeout},
    assumedIdentity,
    reveal: {
      cutoffBps: args["reveal.cutoffBps"],
      adversarialWithholdExecutionPayload: args["adversarial.withhold.executionPayload"],
      adversarialDelayExecutionPayload: args["adversarial.delay.executionPayload"],
      adversarialDelayExecutionPayloadBps: args["adversarial.delay.executionPayloadBps"],
    },
  });

  onGracefulShutdownCbs.push(() => builder?.close());
}

/** Urls are not echoed in errors as they may carry credentials */
export function parseProposerPreferencesUrls(urls: string[], beaconNodeUrl: string): string[] {
  if (urls.length > MAX_ADDITIONAL_PROPOSER_PREFERENCES_SOURCES) {
    throw new YargsError(
      `--proposerPreferences.urls accepts at most ${MAX_ADDITIONAL_PROPOSER_PREFERENCES_SOURCES} urls`
    );
  }
  const seen = new Set(isValidHttpUrl(beaconNodeUrl) ? [new URL(beaconNodeUrl).href] : []);
  for (const [i, url] of urls.entries()) {
    if (!isValidHttpUrl(url)) {
      throw new YargsError(`--proposerPreferences.urls[${i}] is not a valid http(s) url`);
    }
    const href = new URL(url).href;
    if (seen.has(href)) {
      throw new YargsError(`--proposerPreferences.urls[${i}] duplicates --beaconNodeUrl or an earlier url`);
    }
    seen.add(href);
  }
  return urls;
}

function getBuilderApiAuthData(args: IBuilderCliArgs): Uint8Array {
  if (args["builderApi.authData"] !== undefined) {
    const authData = fromHex(args["builderApi.authData"]);
    if (authData.length === 0) {
      throw new YargsError("--builderApi.authData must not be empty");
    }
    return authData;
  }
  if (args["builderApi.publicUrl"] !== undefined) {
    // Same derivation as the default auth data of the validator client
    return new TextEncoder().encode(new URL(args["builderApi.publicUrl"]).hostname);
  }
  throw new YargsError("--builderApi requires either --builderApi.publicUrl or --builderApi.authData");
}

function parseAssumedIdentity(
  index: number | undefined,
  balanceGwei: number | undefined
): {index: number; balanceGwei: number} | undefined {
  if (index === undefined && balanceGwei === undefined) {
    return undefined;
  }
  if (index === undefined || balanceGwei === undefined) {
    throw new YargsError("assumeBuilderIndex and assumeBuilderBalanceGwei must be set together");
  }
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new YargsError(`assumeBuilderIndex must be a non-negative safe integer, got ${index}`);
  }
  if (!Number.isSafeInteger(balanceGwei) || balanceGwei <= 0) {
    throw new YargsError(`assumeBuilderBalanceGwei must be a positive safe integer, got ${balanceGwei}`);
  }
  return {index, balanceGwei};
}
