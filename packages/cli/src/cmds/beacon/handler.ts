import fs from "node:fs";
import path from "node:path";
import {PeerId} from "@libp2p/interface-peer-id";
import {Registry} from "prom-client";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {createKeypairFromPeerId, SignableENR} from "@chainsafe/discv5";
import {ErrorAborted, Logger} from "@lodestar/utils";
import {LevelDbController} from "@lodestar/db";
import {BeaconNode, BeaconDb} from "@lodestar/beacon-node";
import {ChainForkConfig, createBeaconConfig} from "@lodestar/config";
import {ACTIVE_PRESET, PresetName} from "@lodestar/params";
import {ProcessShutdownCallback} from "@lodestar/validator";

import {GlobalArgs, parseBeaconNodeArgs} from "../../options/index.js";
import {BeaconNodeOptions, exportToJSON, getBeaconConfigFromArgs, readPeerId} from "../../config/index.js";
import {getNetworkBootnodes, getNetworkData, isKnownNetworkName, readBootnodes} from "../../networks/index.js";
import {onGracefulShutdown, getCliLogger, mkdir, writeFile600Perm, cleanOldLogFiles} from "../../util/index.js";
import {getVersionData} from "../../util/version.js";
import {defaultP2pPort} from "../../options/beaconNodeOptions/network.js";
import {BeaconArgs} from "./options.js";
import {getBeaconPaths} from "./paths.js";
import {initBeaconState} from "./initBeaconState.js";

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
    controller: new LevelDbController(options.db, {metrics: null}),
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

export function overwriteEnrWithCliArgs(enr: SignableENR, args: BeaconArgs): void {
  // TODO: Not sure if we should propagate port/defaultP2pPort options to the ENR
  enr.tcp = args["enr.tcp"] ?? args.port ?? defaultP2pPort;
  const udpPort = args["enr.udp"] ?? args.discoveryPort ?? args.port ?? defaultP2pPort;
  if (udpPort != null) enr.udp = udpPort;
  if (args["enr.ip"] != null) enr.ip = args["enr.ip"];
  if (args["enr.ip6"] != null) enr.ip6 = args["enr.ip6"];
  if (args["enr.tcp6"] != null) enr.tcp6 = args["enr.tcp6"];
  if (args["enr.udp6"] != null) enr.udp6 = args["enr.udp6"];
}

/**
 * Create new PeerId and ENR by default, unless persistNetworkIdentity is provided
 */
export async function initPeerIdAndEnr(
  args: BeaconArgs,
  beaconDir: string,
  logger: Logger
): Promise<{peerId: PeerId; enr: SignableENR}> {
  const {persistNetworkIdentity} = args;

  const newPeerIdAndENR = async (): Promise<{peerId: PeerId; enr: SignableENR}> => {
    const peerId = await createSecp256k1PeerId();
    const enr = SignableENR.createV4(createKeypairFromPeerId(peerId));
    return {peerId, enr};
  };

  const readPersistedPeerIdAndENR = async (
    peerIdFile: string,
    enrFile: string
  ): Promise<{peerId: PeerId; enr: SignableENR}> => {
    let peerId: PeerId;
    let enr: SignableENR;

    // attempt to read stored peer id
    try {
      peerId = await readPeerId(peerIdFile);
    } catch (e) {
      logger.warn("Unable to read peerIdFile, creating a new peer id");
      return newPeerIdAndENR();
    }
    // attempt to read stored enr
    try {
      enr = SignableENR.decodeTxt(fs.readFileSync(enrFile, "utf-8"), createKeypairFromPeerId(peerId));
    } catch (e) {
      logger.warn("Unable to decode stored local ENR, creating a new ENR");
      enr = SignableENR.createV4(createKeypairFromPeerId(peerId));
      return {peerId, enr};
    }
    // check stored peer id against stored enr
    if (!peerId.equals(await enr.peerId())) {
      logger.warn("Stored local ENR doesn't match peerIdFile, creating a new ENR");
      enr = SignableENR.createV4(createKeypairFromPeerId(peerId));
      return {peerId, enr};
    }
    return {peerId, enr};
  };

  if (persistNetworkIdentity) {
    const enrFile = path.join(beaconDir, "enr");
    const peerIdFile = path.join(beaconDir, "peer-id.json");
    const {peerId, enr} = await readPersistedPeerIdAndENR(peerIdFile, enrFile);
    overwriteEnrWithCliArgs(enr, args);
    // Re-persist peer-id and enr
    writeFile600Perm(peerIdFile, exportToJSON(peerId));
    writeFile600Perm(enrFile, enr.encodeTxt());
    return {peerId, enr};
  } else {
    const {peerId, enr} = await newPeerIdAndENR();
    overwriteEnrWithCliArgs(enr, args);
    return {peerId, enr};
  }
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
