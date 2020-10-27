import {AbortController} from "abort-controller";

import {initBLS} from "@chainsafe/bls";
import {IDiscv5DiscoveryInputOptions} from "@chainsafe/discv5";
import {consoleTransport, fileTransport, WinstonLogger} from "@chainsafe/lodestar-utils";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {BeaconDb} from "@chainsafe/lodestar/lib/db";

import {IGlobalArgs} from "../../options";
import {readPeerId, readEnr, writeEnr} from "../../network";
import {mergeConfigOptions} from "../../config/beacon";
import {getMergedIBeaconConfig} from "../../config/params";
import {initCmd} from "../init/handler";
import {IBeaconArgs} from "./options";
import {getBeaconPaths} from "./paths";
import {updateENR} from "../../util/enr";
import {onGracefulShutdown} from "../../util/process";
import {initBeaconState} from "./initBeaconState";

/**
 * Run a beacon node
 */
export async function beaconHandler(options: IBeaconArgs & IGlobalArgs): Promise<void> {
  await initBLS();
  // always run the init command
  await initCmd(options);

  const beaconPaths = getBeaconPaths(options);
  options = {...options, ...beaconPaths};

  options = mergeConfigOptions(options);
  const peerId = await readPeerId(beaconPaths.peerIdFile);
  // read local enr from disk
  const enr = await readEnr(beaconPaths.enrFile);
  // set enr overrides
  updateENR(enr, options);
  if (!options.network.discv5) options.network.discv5 = {} as IDiscv5DiscoveryInputOptions;
  options.network.discv5.enr = enr;
  options.network.discv5.enrUpdate = !options.enr?.ip && !options.enr?.ip6;
  // TODO: Rename db.name to db.path or db.location
  options.db.name = beaconPaths.dbDir;

  const abortController = new AbortController();
  const loggerTransports = [consoleTransport];
  if (options.logFile && beaconPaths.logFile) {
    loggerTransports.push(fileTransport(beaconPaths.logFile));
  }
  const logger = new WinstonLogger({}, loggerTransports);
  onGracefulShutdown(async () => {
    abortController.abort();
    await writeEnr(beaconPaths.enrFile, enr, peerId);
  }, logger.info.bind(logger));

  const config = await getMergedIBeaconConfig(options.preset, options.paramsFile, options.params);
  const db = new BeaconDb({
    config,
    controller: new LevelDbController(options.db, {logger: logger.child(options.logger.db)}),
  });
  abortController.signal.addEventListener("abort", () => db.stop(), {once: true});
  await db.start();

  const anchorState = await initBeaconState(options, config, db, logger, abortController.signal);
  const node = await BeaconNode.init({
    opts: options,
    config,
    db,
    logger,
    libp2p: await createNodeJsLibp2p(peerId, options.network, options.peerStoreDir),
    anchorState,
  });
  abortController.signal.addEventListener("abort", () => node.close(), {once: true});
}
