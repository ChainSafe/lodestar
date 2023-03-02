import path from "node:path";
import {Registry} from "prom-client";
import {ErrorAborted, Logger} from "@lodestar/utils";
import {LevelDbController} from "@lodestar/db";
import {BeaconNode, BeaconDb} from "@lodestar/beacon-node";
import {ChainForkConfig, createBeaconConfig} from "@lodestar/config";
import {ACTIVE_PRESET, PresetName} from "@lodestar/params";
import {ProcessShutdownCallback} from "@lodestar/validator";

import {GlobalArgs, parseBeaconNodeArgs} from "../../options/index.js";
import {BeaconNodeOptions, getBeaconConfigFromArgs} from "../../config/index.js";
import {getNetworkBootnodes, getNetworkData, isKnownNetworkName, readBootnodes} from "../../networks/index.js";
import {onGracefulShutdown, getCliLogger, mkdir, writeFile600Perm, cleanOldLogFiles} from "../../util/index.js";
import {getVersionData} from "../../util/version.js";
import {BeaconArgs} from "./options.js";
import {getBeaconPaths} from "./paths.js";
import {initBeaconState} from "./initBeaconState.js";
import {initPeerIdAndEnr} from "./initPeerIdAndEnr.js";

/**
 * Runs a beacon node.
 */
export async function beaconHandler(args: BeaconArgs & GlobalArgs): Promise<void> {
  const {config, options, beaconPaths, network, version, commit, peerId, logger} = await beaconHandlerInit(args);

  // initialize directories
  mkdir(beaconPaths.dataDir);
  mkdir(beaconPaths.beaconDir);
  mkdir(beaconPaths.dbDir);

  const abortController = new AbortController();

  logger.info("Lodestar", {network, version, commit});
  // Callback for beacon to request forced exit, for e.g. in case of irrecoverable
  // forkchoice errors
  const processShutdownCallback: ProcessShutdownCallback = (err) => {
    logger.error("Process shutdown requested", {}, err);
    process.kill(process.pid, "SIGINT");
  };

  if (ACTIVE_PRESET === PresetName.minimal) logger.info("ACTIVE_PRESET == minimal preset");

  // additional metrics registries
  const metricsRegistries: Registry[] = [];
  let networkRegistry: Registry | undefined;
  if (options.metrics.enabled) {
    networkRegistry = new Registry();
    metricsRegistries.push(networkRegistry);
  }
  const db = new BeaconDb({
    config,
    controller: new LevelDbController(options.db, {metrics: null, logger}),
  });

  await db.start();
  logger.info("Connected to LevelDB database", {path: options.db.name});

  // BeaconNode setup
  try {
    const {anchorState, wsCheckpoint} = await initBeaconState(
      options,
      args,
      config,
      db,
      logger,
      abortController.signal
    );
    const beaconConfig = createBeaconConfig(config, anchorState.genesisValidatorsRoot);
    const node = await BeaconNode.init({
      opts: options,
      config: beaconConfig,
      db,
      logger,
      processShutdownCallback,
      peerId,
      peerStoreDir: beaconPaths.peerStoreDir,
      anchorState,
      wsCheckpoint,
      metricsRegistries,
    });

    if (args.attachToGlobalThis) ((globalThis as unknown) as {bn: BeaconNode}).bn = node;

    onGracefulShutdown(async () => {
      if (args.persistNetworkIdentity) {
        const enr = await node.network.getEnr().catch((e) => logger.warn("Unable to persist enr", {}, e));
        if (enr) {
          const enrPath = path.join(beaconPaths.beaconDir, "enr");
          writeFile600Perm(enrPath, enr.encodeTxt());
        }
      }
      abortController.abort();
    }, logger.info.bind(logger));

    abortController.signal.addEventListener("abort", () => node.close(), {once: true});
  } catch (e) {
    await db.stop();

    if (e instanceof ErrorAborted) {
      logger.info(e.message); // Let the user know the abort was received but don't print as error
    } else {
      throw e;
    }
  }
}

/** Separate function to simplify unit testing of options merging */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function beaconHandlerInit(args: BeaconArgs & GlobalArgs) {
  const {config, network} = getBeaconConfigFromArgs(args);

  const beaconNodeOptions = new BeaconNodeOptions(parseBeaconNodeArgs(args));

  const {version, commit} = getVersionData();
  const beaconPaths = getBeaconPaths(args, network);
  // TODO: Rename db.name to db.path or db.location
  beaconNodeOptions.set({db: {name: beaconPaths.dbDir}});
  beaconNodeOptions.set({chain: {persistInvalidSszObjectsDir: beaconPaths.persistInvalidSszObjectsDir}});
  // Add metrics metadata to show versioning + network info in Prometheus + Grafana
  beaconNodeOptions.set({metrics: {metadata: {version, commit, network}}});
  // Add detailed version string for API node/version endpoint
  beaconNodeOptions.set({api: {version}});

  // Fetch extra bootnodes
  const extraBootnodes = (beaconNodeOptions.get().network?.discv5?.bootEnrs ?? []).concat(
    args.bootnodesFile ? readBootnodes(args.bootnodesFile) : [],
    isKnownNetworkName(network) ? await getNetworkBootnodes(network) : []
  );
  beaconNodeOptions.set({network: {discv5: {bootEnrs: extraBootnodes}}});

  // Set known depositContractDeployBlock
  if (isKnownNetworkName(network)) {
    const {depositContractDeployBlock} = getNetworkData(network);
    beaconNodeOptions.set({eth1: {depositContractDeployBlock}});
  }

  const logger = initLogger(args, beaconPaths.dataDir, config);
  const {peerId, enr} = await initPeerIdAndEnr(args, beaconPaths.beaconDir, logger);
  // Inject ENR to beacon options
  beaconNodeOptions.set({network: {discv5: {enr, enrUpdate: !enr.ip && !enr.ip6}}});
  // Add simple version string for libp2p agent version
  beaconNodeOptions.set({network: {version: version.split("/")[0]}});

  // Render final options
  const options = beaconNodeOptions.getWithDefaults();

  return {config, options, beaconPaths, network, version, commit, peerId, logger};
}

export function initLogger(args: BeaconArgs, dataDir: string, config: ChainForkConfig): Logger {
  const {logger, logParams} = getCliLogger(args, {defaultLogFilepath: path.join(dataDir, "beacon.log")}, config);
  try {
    cleanOldLogFiles(logParams.filename, logParams.rotateMaxFiles);
  } catch (e) {
    logger.debug("Not able to delete log files", logParams, e as Error);
  }

  return logger;
}
