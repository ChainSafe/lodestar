import process from "process";
import * as path from "path";
import deepmerge from "deepmerge";
import {Arguments} from "yargs";
import {initBLS} from "@chainsafe/bls";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import {config as mainnetConfig} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";

import {readPeerId, readEnr} from "../../../../network";
import {readBeaconConfig} from "../../config";
import {IBeaconArgs} from "../../options";

export interface IBeaconRunArgs extends IBeaconArgs {
}

/**
 * Run a beacon node
 */
export async function run(args: Arguments<IBeaconRunArgs>): Promise<void> {
  await initBLS();

  const peerId = await readPeerId(args.peerIdPath);
  const enr = await readEnr(args.enrPath);

  let options = await readBeaconConfig(args.configPath);
  options = deepmerge(options, args);
  options.network.discv5.enr = enr;

  const config = options.chain.name === "mainnet" ? mainnetConfig : mainnetConfig;
  const libp2p = await createNodeJsLibp2p(peerId, options.network);
  const logger = new WinstonLogger();

  const node = new BeaconNode(options, {
    config,
    libp2p,
    logger,
  });

  async function cleanup(): Promise<void> {
  }

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  await node.start();
}
