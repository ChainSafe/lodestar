import {initBLS} from "@chainsafe/bls";
import {BeaconNode} from "@chainsafe/lodestar";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import {fileTransport, WinstonLogger} from "@chainsafe/lodestar-utils";
import {consoleTransport} from "@chainsafe/lodestar-utils";
import {overwriteEnrWithCliArgs, readPeerId, FileENR} from "../../config";
import {onGracefulShutdown} from "../../util/process";
import {IGlobalArgs} from "../../options";
import {parseEnrArgs} from "../../options/enrOptions";
import {initializeOptionsAndConfig, persistOptionsAndConfig} from "../init/handler";
import {IBeaconArgs} from "./options";
import {getBeaconPaths} from "./paths";
import {initializeBeaconNodeState} from "./util";

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
  const options = beaconNodeOptions.getWithDefaults();

  // ENR setup
  const peerId = await readPeerId(beaconPaths.peerIdFile);
  const enr = FileENR.initFromFile(beaconPaths.enrFile, peerId);
  const enrArgs = parseEnrArgs(args);
  overwriteEnrWithCliArgs(enr, enrArgs, options);
  const enrUpdate = !enrArgs.ip && !enrArgs.ip6;
  beaconNodeOptions.set({network: {discv5: {enr, enrUpdate}}});

  // Logger setup
  const logger = new WinstonLogger({}, [
    consoleTransport,
    ...(beaconPaths.logFile ? [fileTransport(beaconPaths.logFile)] : []),
  ]);

  // BeaconNode setup
  const libp2p = await createNodeJsLibp2p(peerId, options.network, beaconPaths.peerStoreDir);
  const node = new BeaconNode(options, {config, libp2p, logger});

  onGracefulShutdown(async () => {
    await Promise.all([node.stop()]);
  }, logger.info.bind(logger));

  await initializeBeaconNodeState(node, args);
  await node.start();
}
