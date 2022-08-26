import {Registry} from "prom-client";
import {ErrorAborted} from "@lodestar/utils";
import {LevelDbController} from "@lodestar/db";
import {BeaconNode, BeaconDb, createNodeJsLibp2p} from "@lodestar/beacon-node";
import {createIBeaconConfig} from "@lodestar/config";
import {ACTIVE_PRESET, PresetName} from "@lodestar/params";
import {defaultNetwork, IGlobalArgs, parseBeaconNodeArgs} from "../../options/index.js";
import {parseEnrArgs} from "../../options/enrOptions.js";
import {onGracefulShutdown, getCliLogger, mkdir} from "../../util/index.js";
import {
  BeaconNodeOptions,
  createPeerId,
  getBeaconConfigFromArgs,
  initENRandSave,
  overwriteEnrWithCliArgs,
  readPeerId,
} from "../../config/index.js";
import {getNetworkBootnodes, getNetworkData, readBootnodes} from "../../networks/index.js";
import {getVersionData} from "../../util/version.js";
import {IBeaconArgs} from "./options.js";
import {getBeaconPaths} from "./paths.js";
import {initBeaconState} from "./initBeaconState.js";

/**
 * Runs a beacon node.
 */
export async function beaconHandler(args: IBeaconArgs & IGlobalArgs): Promise<void> {
  const config = getBeaconConfigFromArgs(args);
  const network = args.network ?? config.CONFIG_NAME ?? defaultNetwork;

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
  const extraBootnodes = ([] as string[]).concat(
    args.bootnodesFile ? readBootnodes(args.bootnodesFile) : [],
    args.network ? await getNetworkBootnodes(args.network) : []
  );
  beaconNodeOptions.set({network: {discv5: {bootEnrs: extraBootnodes}}});

  // Set known depositContractDeployBlock
  if (args.network) {
    const {depositContractDeployBlock} = getNetworkData(args.network);
    beaconNodeOptions.set({eth1: {depositContractDeployBlock}});
  }

  // initialize directories
  mkdir(beaconPaths.dataDir);
  mkdir(beaconPaths.beaconDir);
  mkdir(beaconPaths.dbDir);

  // ENR setup
  // Create new PeerId everytime
  const peerId = args.peerIdFile ? await readPeerId(args.peerIdFile) : await createPeerId();
  const enr = initENRandSave(beaconPaths.enrFile, peerId);
  const enrArgs = parseEnrArgs(args);
  overwriteEnrWithCliArgs(enr, enrArgs, beaconNodeOptions.getWithDefaults());
  const enrUpdate = !enrArgs.ip && !enrArgs.ip6;
  beaconNodeOptions.set({network: {discv5: {enr, enrUpdate}}});
  const options = beaconNodeOptions.getWithDefaults();

  const abortController = new AbortController();
  const logger = getCliLogger(args, beaconPaths, config);

  onGracefulShutdown(async () => {
    abortController.abort();
  }, logger.info.bind(logger));

  logger.info("Lodestar", {network, version, commit});
  if (ACTIVE_PRESET === PresetName.minimal) logger.info("ACTIVE_PRESET == minimal preset");

  // additional metrics registries
  const metricsRegistries: Registry[] = [];
  const db = new BeaconDb({
    config,
    controller: new LevelDbController(options.db, {logger: logger.child(options.logger.db)}),
  });

  await db.start();

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
      libp2p: await createNodeJsLibp2p(peerId, options.network, {peerStoreDir: beaconPaths.peerStoreDir}),
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
