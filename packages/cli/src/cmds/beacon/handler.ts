import path from "node:path";
import {Registry} from "prom-client";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {createKeypairFromPeerId, ENR} from "@chainsafe/discv5";
import {ErrorAborted} from "@lodestar/utils";
import {LevelDbController} from "@lodestar/db";
import {BeaconNode, BeaconDb, createNodeJsLibp2p} from "@lodestar/beacon-node";
import {createIBeaconConfig} from "@lodestar/config";
import {ACTIVE_PRESET, PresetName} from "@lodestar/params";
import {ProcessShutdownCallback} from "@lodestar/validator";

import {IGlobalArgs, parseBeaconNodeArgs} from "../../options/index.js";
import {BeaconNodeOptions, exportToJSON, FileENR, getBeaconConfigFromArgs} from "../../config/index.js";
import {onGracefulShutdown, getCliLogger, mkdir, writeFile600Perm} from "../../util/index.js";
import {getNetworkBootnodes, getNetworkData, readBootnodes} from "../../networks/index.js";
import {getVersionData} from "../../util/version.js";
import {defaultP2pPort} from "../../options/beaconNodeOptions/network.js";
import {IBeaconArgs} from "./options.js";
import {getBeaconPaths} from "./paths.js";
import {initBeaconState} from "./initBeaconState.js";

/**
 * Runs a beacon node.
 */
export async function beaconHandler(args: IBeaconArgs & IGlobalArgs): Promise<void> {
  const {config, options, beaconPaths, network, version, commit, peerId} = await beaconHandlerInit(args);

  // initialize directories
  mkdir(beaconPaths.dataDir);
  mkdir(beaconPaths.beaconDir);
  mkdir(beaconPaths.dbDir);

  const abortController = new AbortController();
  const logger = getCliLogger(args, {defaultLogFilepath: path.join(beaconPaths.dataDir, "beacon.log")}, config);

  onGracefulShutdown(async () => {
    abortController.abort();
  }, logger.info.bind(logger));

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
    const beaconConfig = createIBeaconConfig(config, anchorState.genesisValidatorsRoot);
    const node = await BeaconNode.init({
      opts: options,
      config: beaconConfig,
      db,
      logger,
      processShutdownCallback,
      libp2p: await createNodeJsLibp2p(peerId, options.network, {
        peerStoreDir: beaconPaths.peerStoreDir,
        metrics: options.metrics.enabled,
      }),
      anchorState,
      wsCheckpoint,
      metricsRegistries,
    });

    if (args.attachToGlobalThis) ((globalThis as unknown) as {bn: BeaconNode}).bn = node;

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
export async function beaconHandlerInit(args: IBeaconArgs & IGlobalArgs) {
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
    args.network ? await getNetworkBootnodes(args.network) : []
  );
  beaconNodeOptions.set({network: {discv5: {bootEnrs: extraBootnodes}}});

  // Set known depositContractDeployBlock
  if (args.network) {
    const {depositContractDeployBlock} = getNetworkData(args.network);
    beaconNodeOptions.set({eth1: {depositContractDeployBlock}});
  }

  // Create new PeerId everytime by default, unless peerIdFile is provided
  const peerId = await createSecp256k1PeerId();
  const enr = ENR.createV4(createKeypairFromPeerId(peerId).publicKey);
  overwriteEnrWithCliArgs(enr, args);

  // Persist ENR and PeerId in beaconDir fixed paths for debugging
  const pIdPath = path.join(beaconPaths.beaconDir, "peer_id.json");
  const enrPath = path.join(beaconPaths.beaconDir, "enr");
  writeFile600Perm(pIdPath, exportToJSON(peerId));
  const fileENR = FileENR.initFromENR(enrPath, peerId, enr);
  fileENR.saveToFile();

  // Inject ENR to beacon options
  beaconNodeOptions.set({network: {discv5: {enr: fileENR, enrUpdate: !enr.ip && !enr.ip6}}});
  // Add simple version string for libp2p agent version
  beaconNodeOptions.set({network: {version: version.split("/")[0]}});

  // Render final options
  const options = beaconNodeOptions.getWithDefaults();

  return {config, options, beaconPaths, network, version, commit, peerId};
}

export function overwriteEnrWithCliArgs(enr: ENR, args: IBeaconArgs): void {
  // TODO: Not sure if we should propagate port/defaultP2pPort options to the ENR
  enr.tcp = args["enr.tcp"] ?? args.port ?? defaultP2pPort;
  // TODO: add `port`/`defaultP2pPort` port as backup as well once we
  // fix the below discv5 issue
  //
  // See https://github.com/ChainSafe/discv5/issues/201
  const udpPort = args["enr.udp"] ?? args.discoveryPort;
  if (udpPort != null) enr.udp = udpPort;
  if (args["enr.ip"] != null) enr.ip = args["enr.ip"];
  if (args["enr.ip6"] != null) enr.ip6 = args["enr.ip6"];
  if (args["enr.tcp6"] != null) enr.tcp6 = args["enr.tcp6"];
  if (args["enr.udp6"] != null) enr.udp6 = args["enr.udp6"];
}
