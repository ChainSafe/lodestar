import path from "node:path";
import {getHeapStatistics} from "node:v8";
import {SignableENR} from "@chainsafe/enr";
import {hasher} from "@chainsafe/persistent-merkle-tree";
import {BeaconDb, BeaconNode} from "@lodestar/beacon-node";
import {ChainForkConfig, createBeaconConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db/controller/level";
import {LoggerNode, getNodeLogger} from "@lodestar/logger/node";
import {ACTIVE_PRESET, PresetName} from "@lodestar/params";
import {ErrorAborted, bytesToInt, formatBytes} from "@lodestar/utils";
import {ProcessShutdownCallback} from "@lodestar/validator";
import {BeaconNodeOptions, getBeaconConfigFromArgs} from "../../config/index.js";
import {getNetworkBootnodes, isKnownNetworkName, readBootnodes} from "../../networks/index.js";
import {GlobalArgs, parseBeaconNodeArgs} from "../../options/index.js";
import {LogArgs} from "../../options/logOptions.js";
import {
  cleanOldLogFiles,
  mkdir,
  onGracefulShutdown,
  parseLoggerArgs,
  pruneOldFilesInDir,
  writeFile600Perm,
} from "../../util/index.js";
import {getVersionData} from "../../util/version.js";
import {initBeaconState} from "./initBeaconState.js";
import {initPrivateKeyAndEnr} from "./initPeerIdAndEnr.js";
import {BeaconArgs} from "./options.js";
import {getBeaconPaths} from "./paths.js";

const DEFAULT_RETENTION_SSZ_OBJECTS_HOURS = 15 * 24;
const HOURS_TO_MS = 3600 * 1000;
const EIGHT_GB = 8 * 1024 * 1024 * 1024;

/**
 * Runs a beacon node.
 */
export async function beaconHandler(args: BeaconArgs & GlobalArgs): Promise<void> {
  const {config, options, beaconPaths, network, version, commit, privateKey, logger} = await beaconHandlerInit(args);

  if (hasher.name !== "hashtree") {
    logger.warn(`hashtree is not supported, using hasher ${hasher.name}`);
  }

  const heapSizeLimit = getHeapStatistics().heap_size_limit;
  if (heapSizeLimit < EIGHT_GB) {
    logger.warn(
      `Node.js heap size limit is too low at ${formatBytes(heapSizeLimit)}, consider increasing it to at least ${formatBytes(EIGHT_GB)}. See https://chainsafe.github.io/lodestar/faqs/#running-a-beacon-node for more details.`
    );
  }

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

  const db = new BeaconDb(config, await LevelDbController.create(options.db, {metrics: null, logger}));
  logger.info("Connected to LevelDB database", {path: options.db.name});

  // BeaconNode setup
  try {
    const {anchorState, isFinalized, wsCheckpoint} = await initBeaconState(
      args,
      beaconPaths.dataDir,
      config,
      db,
      logger
    );
    const beaconConfig = createBeaconConfig(config, anchorState.genesisValidatorsRoot);
    const node = await BeaconNode.init({
      opts: options,
      config: beaconConfig,
      db,
      logger,
      processShutdownCallback,
      privateKey,
      dataDir: beaconPaths.dataDir,
      peerStoreDir: beaconPaths.peerStoreDir,
      anchorState,
      isAnchorStateFinalized: isFinalized,
      wsCheckpoint,
    });

    // dev debug option to have access to the BN instance
    if (args.attachToGlobalThis) {
      (globalThis as unknown as {bn: BeaconNode}).bn = node;
    }

    // Prune invalid SSZ objects every interval
    const {persistInvalidSszObjectsDir, persistInvalidSszObjects} = options.chain;
    const pruneInvalidSSZObjectsInterval =
      persistInvalidSszObjectsDir && persistInvalidSszObjects
        ? setInterval(() => {
            try {
              const deletedFileCount = pruneOldFilesInDir(
                persistInvalidSszObjectsDir,
                (args.persistInvalidSszObjectsRetentionHours ?? DEFAULT_RETENTION_SSZ_OBJECTS_HOURS) * HOURS_TO_MS
              );
              logger.info("Pruned invalid SSZ objects", {deletedFileCount});
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
          // If we start from unfinalized state, we don't have checkpoint state so there is this error
          // "No state in cache for finalized checkpoint state epoch"
          logger.warn("Error closing beacon node", {}, e as Error);
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
export async function beaconHandlerInit(args: BeaconArgs & GlobalArgs) {
  const {config, network} = getBeaconConfigFromArgs(args);

  const beaconNodeOptions = new BeaconNodeOptions(parseBeaconNodeArgs(args));

  const {version, commit} = getVersionData();
  const beaconPaths = getBeaconPaths(args, network);
  // TODO: Rename db.name to db.path or db.location
  beaconNodeOptions.set({db: {name: beaconPaths.dbDir}});
  beaconNodeOptions.set({
    chain: {
      validatorMonitorLogs: args.validatorMonitorLogs,
      persistInvalidSszObjectsDir: beaconPaths.persistInvalidSszObjectsDir,
      persistOrphanedBlocksDir: beaconPaths.persistOrphanedBlocksDir,
    },
  });
  // Add metrics metadata to show versioning + network info in Prometheus + Grafana
  beaconNodeOptions.set({metrics: {metadata: {version, commit, network}}});
  // Add detailed version string for API node/version endpoint
  beaconNodeOptions.set({api: {commit, version}});

  const logger = initLogger(args, beaconPaths.dataDir, config);
  const {privateKey, enr} = await initPrivateKeyAndEnr(args, beaconPaths.beaconDir, logger);

  if (args.discv5 !== false) {
    // Inject ENR to beacon options
    beaconNodeOptions.set({network: {discv5: {enr: enr.encodeTxt(), config: {enrUpdate: !enr.ip && !enr.ip6}}}});

    // Combine bootnodes from different sources
    const bootnodes = (beaconNodeOptions.get().network?.discv5?.bootEnrs ?? []).concat(
      args.bootnodesFile ? readBootnodes(args.bootnodesFile) : [],
      isKnownNetworkName(network) ? await getNetworkBootnodes(network) : []
    );
    // Deduplicate and set combined bootnodes
    beaconNodeOptions.set({network: {discv5: {bootEnrs: [...new Set(bootnodes)]}}});
  }

  beaconNodeOptions.set({chain: {initialCustodyGroupCount: getInitialCustodyGroupCount(args, config, logger, enr)}});

  if (args.disableLightClientServer) {
    beaconNodeOptions.set({chain: {disableLightClientServer: true}});
  }

  if (args.private) {
    beaconNodeOptions.set({network: {private: true}, api: {private: true}});
  } else {
    const versionStr = `Lodestar/${version}`;
    // Add version string for libp2p agent version
    beaconNodeOptions.set({network: {version}});
    // Add User-Agent header to all builder requests
    beaconNodeOptions.set({executionBuilder: {userAgent: versionStr}});
    // Set jwt version with version string
    beaconNodeOptions.set({executionEngine: {jwtVersion: versionStr}});
    // Set commit and version for ClientVersion
    beaconNodeOptions.set({executionEngine: {commit, version}});
  }

  // Render final options
  const options = beaconNodeOptions.getWithDefaults();

  return {config, options, beaconPaths, network, version, commit, privateKey, logger};
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

function getInitialCustodyGroupCount(
  args: BeaconArgs & GlobalArgs,
  config: ChainForkConfig,
  logger: LoggerNode,
  enr: SignableENR
): number {
  if (args.supernode) {
    return config.NUMBER_OF_CUSTODY_GROUPS;
  }

  const enrCgcBytes = enr.kvs.get("cgc");
  const enrCgc = enrCgcBytes != null ? bytesToInt(enrCgcBytes, "be") : 0;

  if (args.semiSupernode) {
    const semiSupernodeCgc = Math.floor(config.NUMBER_OF_CUSTODY_GROUPS / 2);
    if (enrCgc > semiSupernodeCgc) {
      logger.warn(
        `Reducing custody requirements is not supported, will continue to use custody group count of ${enrCgc}`
      );
    }
    return Math.max(enrCgc, semiSupernodeCgc);
  }

  return Math.max(enrCgc, config.CUSTODY_REQUIREMENT);
}
