import path from "node:path";
import {Registry} from "prom-client";
import {ErrorAborted} from "@lodestar/utils";
import {LevelDbController} from "@lodestar/db";
import {BeaconNode, BeaconDb} from "@lodestar/beacon-node";
import {ChainForkConfig, createBeaconConfig} from "@lodestar/config";
import {ACTIVE_PRESET, PresetName} from "@lodestar/params";
import {ProcessShutdownCallback} from "@lodestar/validator";
import {LoggerNode, getNodeLogger} from "@lodestar/logger/node";

import {GlobalArgs, parseBeaconNodeArgs} from "../../options/index.js";
import {BeaconNodeOptions, getBeaconConfigFromArgs} from "../../config/index.js";
import {getNetworkBootnodes, getNetworkData, isKnownNetworkName, readBootnodes} from "../../networks/index.js";
import {
  onGracefulShutdown,
  mkdir,
  writeFile600Perm,
  cleanOldLogFiles,
  parseLoggerArgs,
  pruneOldFilesInDir,
} from "../../util/index.js";
import {getVersionData} from "../../util/version.js";
import {LogArgs} from "../../options/logOptions.js";
import {BeaconArgs} from "./options.js";
import {getBeaconPaths} from "./paths.js";
import {initBeaconState} from "./initBeaconState.js";
import {initPeerIdAndEnr} from "./initPeerIdAndEnr.js";

const DEFAULT_RETENTION_SSZ_OBJECTS_HOURS = 15 * 24;
const HOURS_TO_MS = 3600 * 1000;

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
  const db = new BeaconDb(config, await LevelDbController.create(options.db, {metrics: null, logger}));
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

    // dev debug option to have access to the BN instance
    if (args.attachToGlobalThis) {
      (globalThis as unknown as {bn: BeaconNode}).bn = node;
    }

    // Prune invalid SSZ objects every interval
    const {persistInvalidSszObjectsDir} = args;
    const pruneInvalidSSZObjectsInterval = persistInvalidSszObjectsDir
      ? setInterval(() => {
          try {
            pruneOldFilesInDir(
              persistInvalidSszObjectsDir,
              (args.persistInvalidSszObjectsRetentionHours ?? DEFAULT_RETENTION_SSZ_OBJECTS_HOURS) * HOURS_TO_MS
            );
          } catch (e) {
            logger.warn("Error pruning invalid SSZ objects", {persistInvalidSszObjectsDir}, e as Error);
          }
          // Run every ~1 hour
        }, HOURS_TO_MS)
      : null;

    // Intercept SIGINT signal, to perform final ops before exiting
    onGracefulShutdown(async () => {
      if (args.persistNetworkIdentity) {
        try {
          const networkIdentity = await node.network.getNetworkIdentity();
          const enrPath = path.join(beaconPaths.beaconDir, "enr");
          writeFile600Perm(enrPath, networkIdentity.enr);
        } catch (e) {
          logger.warn("Unable to persist enr", {}, e as Error);
        }
      }
      abortController.abort();

      if (pruneInvalidSSZObjectsInterval !== null) {
        clearInterval(pruneInvalidSSZObjectsInterval);
      }
    }, logger.info.bind(logger));

    abortController.signal.addEventListener(
      "abort",
      async () => {
        try {
          await node.close();
          logger.debug("Beacon node closed");
          // Explicitly exit until active handles issue is resolved
          // See https://github.com/ChainSafe/lodestar/issues/5642
          process.exit(0);
        } catch (e) {
          logger.error("Error closing beacon node", {}, e as Error);
          // Make sure db is always closed gracefully
          await db.close();
          // Must explicitly exit process due to potential active handles
          process.exit(1);
        }
      },
      {once: true}
    );
  } catch (e) {
    await db.close();

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

  // Combine bootnodes from different sources
  const bootnodes = (beaconNodeOptions.get().network?.discv5?.bootEnrs ?? []).concat(
    args.bootnodesFile ? readBootnodes(args.bootnodesFile) : [],
    isKnownNetworkName(network) ? await getNetworkBootnodes(network) : []
  );
  // Deduplicate and set combined bootnodes
  beaconNodeOptions.set({network: {discv5: {bootEnrs: [...new Set(bootnodes)]}}});

  // Set known depositContractDeployBlock
  if (isKnownNetworkName(network)) {
    const {depositContractDeployBlock} = getNetworkData(network);
    beaconNodeOptions.set({eth1: {depositContractDeployBlock}});
  }

  const logger = initLogger(args, beaconPaths.dataDir, config);
  const {peerId, enr} = await initPeerIdAndEnr(args, beaconPaths.beaconDir, logger);
  // Inject ENR to beacon options
  beaconNodeOptions.set({network: {discv5: {enr: enr.encodeTxt(), config: {enrUpdate: !enr.ip && !enr.ip6}}}});

  if (args.private) {
    beaconNodeOptions.set({network: {private: true}});
  } else {
    // Add simple version string for libp2p agent version
    beaconNodeOptions.set({network: {version: version.split("/")[0]}});
    // Add User-Agent header to all builder requests
    beaconNodeOptions.set({executionBuilder: {userAgent: `Lodestar/${version}`}});
  }

  // Render final options
  const options = beaconNodeOptions.getWithDefaults();

  return {config, options, beaconPaths, network, version, commit, peerId, logger};
}

export function initLogger(
  args: LogArgs & Pick<GlobalArgs, "dataDir">,
  dataDir: string,
  config: ChainForkConfig,
  fileName = "beacon.log"
): LoggerNode {
  const defaultLogFilepath = path.join(dataDir, fileName);
  const logger = getNodeLogger(parseLoggerArgs(args, {defaultLogFilepath}, config));
  try {
    cleanOldLogFiles(args, {defaultLogFilepath});
  } catch (e) {
    logger.debug("Not able to delete log files", {}, e as Error);
  }

  return logger;
}
