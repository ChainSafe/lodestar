import * as fs from "fs";
import {initBLS} from "@chainsafe/bls";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import {fileTransport, WinstonLogger} from "@chainsafe/lodestar-utils";
import {consoleTransport} from "@chainsafe/lodestar-utils";
import {overwriteEnrWithCliArgs, readPeerId, readEnr, writeEnr} from "../../config";
import {onGracefulShutdown} from "../../util/process";
import {IGlobalArgs} from "../../options";
import {parseEnrArgs} from "../../options/enrOptions";
import {initializeOptionsAndConfig, persistOptionsAndConfig} from "../init/handler";
import {IBeaconArgs} from "./options";
import {getBeaconPaths} from "./paths";

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
  const enr = await readEnr(beaconPaths.enrFile);
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

  const peerId = await readPeerId(beaconPaths.peerIdFile);
  const libp2p = await createNodeJsLibp2p(peerId, options.network, beaconPaths.peerStoreDir);
  const node = new BeaconNode(options, {config, libp2p, logger});

  onGracefulShutdown(async () => {
    await Promise.all([node.stop(), writeEnr(beaconPaths.enrFile, enr, peerId)]);
  }, logger.info.bind(logger));

  if (args.weakSubjectivityStateFile) {
    const weakSubjectivityState = config.types.BeaconState.tree.deserialize(
      await fs.promises.readFile(args.weakSubjectivityStateFile)
    );
    await node.chain.initializeWeakSubjectivityState(weakSubjectivityState);
  } else if (args.genesisStateFile && !args.forceGenesis) {
    await node.chain.initializeBeaconChain(
      config.types.BeaconState.tree.deserialize(await fs.promises.readFile(args.genesisStateFile))
    );
  }
  await node.start();
}
