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
import {exportToJSON, FileENR, getBeaconConfigFromArgs} from "../../config/index.js";
import {onGracefulShutdown, getCliLogger, mkdir, writeFile600Perm} from "../../util/index.js";
import {getNetworkBootnodes, getNetworkData, readBootnodes} from "../../networks/index.js";
import {getVersionData} from "../../util/version.js";
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
    controller: new LevelDbController({name: beaconPaths.dbDir}, {metrics: null}),
  });

  await db.start();
  logger.info("Connected to LevelDB database", {path: beaconPaths.dbDir});

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

  const options = parseBeaconNodeArgs(args);

  const {version, commit} = getVersionData();
  const beaconPaths = getBeaconPaths(args, network);

  if (!options.chain) options.chain = {};
  options.chain.persistInvalidSszObjectsDir = beaconPaths.persistInvalidSszObjectsDir;
  // Add metrics metadata to show versioning + network info in Prometheus + Grafana
  if (!options.metrics) options.metrics = {};
  options.metrics.metadata = {version, commit, network};
  // Add detailed version string for API node/version endpoint
  if (!options.api) options.api = {};
  options.api.version = version;

  // Fetch extra bootnodes
  const extraBootnodes = (options.network?.bootnodes ?? []).concat(
    args.bootnodesFile ? readBootnodes(args.bootnodesFile) : [],
    args.network ? await getNetworkBootnodes(args.network) : []
  );
  if (!options.network) options.network = {};
  options.network.bootnodes = extraBootnodes;

  // Set known depositContractDeployBlock
  if (args.network) {
    const {depositContractDeployBlock} = getNetworkData(args.network);
    if (!options.eth1) options.eth1 = {};
    options.eth1.depositContractDeployBlock = depositContractDeployBlock;
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
  options.network.enr = fileENR;

  return {config, options, beaconPaths, network, version, commit, peerId};
}

export function overwriteEnrWithCliArgs(enr: ENR, args: IBeaconArgs): void {
  // TODO: Not sure if we should propagate this options to the ENR
  if (args.port != null) enr.tcp = args.port;
  // TODO: reenable this once we fix the below discv5 issue
  // See https://github.com/ChainSafe/discv5/issues/201
  // if (args.port != null) enr.udp = args.port;
  if (args.discoveryPort != null) enr.udp = args.discoveryPort;

  if (args["enr.ip"] != null) enr.ip = args["enr.ip"];
  if (args["enr.tcp"] != null) enr.tcp = args["enr.tcp"];
  if (args["enr.udp"] != null) enr.udp = args["enr.udp"];
  if (args["enr.ip6"] != null) enr.ip6 = args["enr.ip6"];
  if (args["enr.tcp6"] != null) enr.tcp6 = args["enr.tcp6"];
  if (args["enr.udp6"] != null) enr.udp6 = args["enr.udp6"];
}
