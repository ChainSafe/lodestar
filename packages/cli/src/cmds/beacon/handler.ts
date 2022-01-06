import {AbortController} from "@chainsafe/abort-controller";
import {ErrorAborted} from "@chainsafe/lodestar-utils";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {BeaconNode, BeaconDb, createNodeJsLibp2p} from "@chainsafe/lodestar";
// eslint-disable-next-line no-restricted-imports
import {createDbMetrics} from "@chainsafe/lodestar/lib/metrics";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {ACTIVE_PRESET, PresetName} from "@chainsafe/lodestar-params";
import {IGlobalArgs} from "../../options";
import {parseEnrArgs} from "../../options/enrOptions";
import {initBLS, onGracefulShutdown, getCliLogger} from "../../util";
import {FileENR, overwriteEnrWithCliArgs, readPeerId} from "../../config";
import {initializeOptionsAndConfig, persistOptionsAndConfig} from "../init/handler";
import {IBeaconArgs} from "./options";
import {getBeaconPaths} from "./paths";
import {initBeaconState} from "./initBeaconState";
import {getVersion, getVersionGitData} from "../../util/version";

/**
 * Runs a beacon node.
 */
export async function beaconHandler(args: IBeaconArgs & IGlobalArgs): Promise<void> {
  await initBLS();

  const {beaconNodeOptions, config} = await initializeOptionsAndConfig(args);
  await persistOptionsAndConfig(args);

  const version = getVersion();
  const gitData = getVersionGitData();
  const beaconPaths = getBeaconPaths(args);
  // TODO: Rename db.name to db.path or db.location
  beaconNodeOptions.set({db: {name: beaconPaths.dbDir}});
  beaconNodeOptions.set({chain: {persistInvalidSszObjectsDir: beaconPaths.persistInvalidSszObjectsDir}});
  // Add metrics metadata to show versioning + network info in Prometheus + Grafana
  beaconNodeOptions.set({metrics: {metadata: {...gitData, version, network: args.network}}});
  // Add detailed version string for API node/version endpoint
  beaconNodeOptions.set({api: {version: version}});

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

  logger.info("Lodestar", {version: version, network: args.network});
  if (ACTIVE_PRESET === PresetName.minimal) logger.info("ACTIVE_PRESET == minimal preset");

  let dbMetrics: null | ReturnType<typeof createDbMetrics> = null;
  // additional metrics registries
  const metricsRegistries = [];
  if (options.metrics.enabled) {
    dbMetrics = createDbMetrics();
    metricsRegistries.push(dbMetrics.registry);
  }
  const db = new BeaconDb({
    config,
    controller: new LevelDbController(options.db, {logger: logger.child(options.logger.db)}),
    metrics: dbMetrics?.metrics,
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
