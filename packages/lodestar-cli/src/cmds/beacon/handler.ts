import * as fs from "fs";
import {initBLS} from "@chainsafe/bls";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import {fileTransport, WinstonLogger} from "@chainsafe/lodestar-utils";
import {IDiscv5DiscoveryInputOptions} from "@chainsafe/discv5";
import {consoleTransport} from "@chainsafe/lodestar-utils";
import {IGlobalArgs, toBeaconNodeOptions} from "../../options";
import {readPeerId, readEnr, writeEnr} from "../../network";
import {processBeaconNodeOptions} from "../../config/beacon";
import {getMergedIBeaconConfig} from "../../config/params";
import {initCmd} from "../init/handler";
import {IBeaconArgs} from "./options";
import {getBeaconPaths} from "./paths";
import {overwriteEnrWithCliArgs} from "../../config/enr";
import {onGracefulShutdown} from "../../util/process";
import {parseEnrArgs} from "@chainsafe/lodestar-cli/src/options/enrOptions";

/**
 * Run a beacon node
 */
export async function beaconHandler(args: IBeaconArgs & IGlobalArgs): Promise<void> {
  await initBLS();
  // always run the init command
  await initCmd(args);

  const beaconPaths = getBeaconPaths(args);
  const beaconNodeOptions = processBeaconNodeOptions({
    beaconNodeArgs: toBeaconNodeOptions(args),
    configFile: beaconPaths.configFile,
  });

  // ENR setup
  const enr = await readEnr(beaconPaths.enrFile);
  const enrArgs = parseEnrArgs(args);
  overwriteEnrWithCliArgs(enr, enrArgs, beaconNodeOptions);
  if (!beaconNodeOptions.network.discv5) beaconNodeOptions.network.discv5 = {} as IDiscv5DiscoveryInputOptions;
  beaconNodeOptions.network.discv5.enr = enr;
  beaconNodeOptions.network.discv5.enrUpdate = !enrArgs.ip && !enrArgs.ip6;

  // TODO: Rename db.name to db.path or db.location
  beaconNodeOptions.db.name = beaconPaths.dbDir;

  // Logger setup
  const logger = new WinstonLogger({}, [
    consoleTransport,
    ...(beaconPaths.logFile ? [fileTransport(beaconPaths.logFile)] : []),
  ]);

  // BeaconNode setup
  const peerId = await readPeerId(beaconPaths.peerIdFile);
  const config = await getMergedIBeaconConfig(args.preset, args.paramsFile, args.params);
  const libp2p = await createNodeJsLibp2p(peerId, beaconNodeOptions.network, beaconPaths.peerStoreDir);
  const node = new BeaconNode(beaconNodeOptions, {config, libp2p, logger});

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
