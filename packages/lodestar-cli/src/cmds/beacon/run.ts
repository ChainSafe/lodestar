import * as fs from "fs";
import path from "path";
import process from "process";
import {initBLS} from "@chainsafe/bls";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import {fileTransport, WinstonLogger} from "@chainsafe/lodestar-utils";
import {ENR} from "@chainsafe/discv5";
import {consoleTransport} from "@chainsafe/lodestar-utils";

import {readPeerId, readEnr, writeEnr} from "../../network";
import {mergeConfigOptions} from "../../config/beacon";
import {getBeaconConfig} from "../../util";
import {initHandler as initCmd} from "../init/init";
import {IBeaconOptions} from "./options";
import {getBeaconPaths} from "./paths";

/**
 * Run a beacon node
 */
export async function run(options: IBeaconOptions): Promise<void> {
  await initBLS();
  // Auto-setup testnet
  if (options.testnet) {
    await initCmd(options);
  }
  const beaconPaths = getBeaconPaths(options);
  options = {...options, ...beaconPaths};

  options = mergeConfigOptions(options);
  const peerId = await readPeerId(beaconPaths.peerIdFile);
  // read local enr from disk
  options.network.discv5.enr = await readEnr(beaconPaths.enrFile);
  // TODO: Rename db.name to db.path or db.location
  options.db.name = beaconPaths.dbDir;

  const config = getBeaconConfig(options.preset, options.params);
  const libp2p = await createNodeJsLibp2p(peerId, options.network);
  const loggerTransports = [
    consoleTransport
  ];
  if(options.logFile) {
    loggerTransports.push(fileTransport(path.join(options.rootDir, options.logFile)));
  }
  const logger = new WinstonLogger({}, loggerTransports);

  const node = new BeaconNode(options, {config, libp2p, logger});

  async function cleanup(): Promise<void> {
    await node.stop();
    await writeEnr(beaconPaths.enrFile, options.network.discv5.enr as ENR, peerId);
  }

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  if (options.genesisStateFile) {
    await node.chain.initializeBeaconChain(
      config.types.BeaconState.tree.deserialize(await fs.promises.readFile(options.genesisStateFile))
    );
  }
  await node.start();
}
