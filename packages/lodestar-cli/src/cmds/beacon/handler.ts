import {AbortController} from "abort-controller";

import {initBLS} from "@chainsafe/bls";
import {consoleTransport, fileTransport, WinstonLogger} from "@chainsafe/lodestar-utils";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {BeaconDb} from "@chainsafe/lodestar/lib/db";

import {IGlobalArgs} from "../../options";
import {parseEnrArgs} from "../../options/enrOptions";
import {initializeOptionsAndConfig, persistOptionsAndConfig} from "../init/handler";
import {IBeaconArgs} from "./options";
import {getBeaconPaths} from "./paths";
import {onGracefulShutdown} from "../../util/process";
import {FileENR, overwriteEnrWithCliArgs, readPeerId} from "../../config";
import {initBeaconState} from "./initBeaconState";

/**
 * Run a beacon node
 */
export async function beaconHandler(args: IBeaconArgs & IGlobalArgs): Promise<void> {
  await initBLS();

  const {beaconNodeOptions, config} = await initializeOptionsAndConfig(args);
  await persistOptionsAndConfig(args, beaconNodeOptions, config);

  const beaconPaths = getBeaconPaths(args);
  // TODO: Rename db.name to db.path or db.location
  beaconNodeOptions.set({db: {name: beaconPaths.dbDir}});

  // ENR setup
  const peerId = await readPeerId(beaconPaths.peerIdFile);
  const enr = FileENR.initFromFile(beaconPaths.enrFile, peerId);
  const enrArgs = parseEnrArgs(args);
  overwriteEnrWithCliArgs(enr, enrArgs, beaconNodeOptions.getWithDefaults());
  const enrUpdate = !enrArgs.ip && !enrArgs.ip6;
  beaconNodeOptions.set({network: {discv5: {enr, enrUpdate}}});
  const options = beaconNodeOptions.getWithDefaults();

  const abortController = new AbortController();

  // Logger setup
  const logger = new WinstonLogger({}, [
    consoleTransport,
    ...(beaconPaths.logFile ? [fileTransport(beaconPaths.logFile)] : []),
  ]);

  onGracefulShutdown(async () => {
    abortController.abort();
  }, logger.info.bind(logger));

  const db = new BeaconDb({
    config,
    controller: new LevelDbController(options.db, {logger: logger.child(options.logger.db)}),
  });
  const dbClose = (): Promise<void> => db.stop();
  abortController.signal.addEventListener("abort", dbClose, {once: true});
  await db.start();

  // BeaconNode setup
  const anchorState = await initBeaconState(options, args, config, db, logger, abortController.signal);
  const node = await BeaconNode.init({
    opts: options,
    config,
    db,
    logger,
    libp2p: await createNodeJsLibp2p(peerId, options.network, beaconPaths.peerStoreDir),
    anchorState,
  });
  abortController.signal.removeEventListener("abort", dbClose);
  abortController.signal.addEventListener("abort", () => node.close(), {once: true});
}
