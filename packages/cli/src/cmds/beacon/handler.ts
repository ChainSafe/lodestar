import {Registry} from "prom-client";
import {ErrorAborted} from "@chainsafe/lodestar-utils";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {BeaconNode, BeaconDb, createNodeJsLibp2p} from "@chainsafe/lodestar";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {ACTIVE_PRESET, PresetName} from "@chainsafe/lodestar-params";
import {IGlobalArgs} from "../../options/index.js";
import {parseEnrArgs} from "../../options/enrOptions.js";
import {onGracefulShutdown, getCliLogger} from "../../util/index.js";
import {FileENR, overwriteEnrWithCliArgs, readPeerId} from "../../config/index.js";
import {initializeOptionsAndConfig, persistOptionsAndConfig} from "../init/handler.js";
import {IBeaconArgs} from "./options.js";
import {getBeaconPaths} from "./paths.js";
import {initBeaconState} from "./initBeaconState.js";
import {getVersionData} from "../../util/version.js";
import {deleteOldPeerstorePreV036} from "../../migrations/index.js";

/**
 * Runs a beacon node.
 */
export async function beaconHandler(args: IBeaconArgs & IGlobalArgs): Promise<void> {
  const {beaconNodeOptions, config} = await initializeOptionsAndConfig(args);
  await persistOptionsAndConfig(args);

  const {version, commit} = getVersionData();
  const beaconPaths = getBeaconPaths(args);
  // TODO: Rename db.name to db.path or db.location
  beaconNodeOptions.set({db: {name: beaconPaths.dbDir}});
  beaconNodeOptions.set({chain: {persistInvalidSszObjectsDir: beaconPaths.persistInvalidSszObjectsDir}});
  // Add metrics metadata to show versioning + network info in Prometheus + Grafana
  beaconNodeOptions.set({metrics: {metadata: {version, commit, network: args.network}}});
  // Add detailed version string for API node/version endpoint
  beaconNodeOptions.set({api: {version}});

  // ENR setup
  const peerId = await readPeerId(beaconPaths.peerIdFile);
  const enr = FileENR.initFromFile(beaconPaths.enrFile, peerId);
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

  logger.info("Lodestar", {network: args.network, version, commit});
  if (ACTIVE_PRESET === PresetName.minimal) logger.info("ACTIVE_PRESET == minimal preset");

  // peerstore migration
  await deleteOldPeerstorePreV036(beaconPaths.peerStoreDir, logger);

  // additional metrics registries
  const metricsRegistries: Registry[] = [];
  const db = new BeaconDb({
    config,
    controller: new LevelDbController(options.db, {logger: logger.child(options.logger.db)}),
    metrics: options.metrics.enabled,
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
