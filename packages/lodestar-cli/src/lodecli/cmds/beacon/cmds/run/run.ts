import process from "process";
import {Arguments} from "yargs";
import deepmerge from "deepmerge";
import {initBLS} from "@chainsafe/bls";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import {config as mainnetConfig} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import defaultOptions, {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";

import {readPeerId, readEnr, writeEnr} from "../../../../network";
import {IBeaconArgs} from "../../options";

/**
 * Run a beacon node
 */
export async function run(options: Arguments<IBeaconArgs & Partial<IBeaconNodeOptions>>): Promise<void> {
  await initBLS();

  options = deepmerge(defaultOptions, options) as Arguments<IBeaconArgs & Partial<IBeaconNodeOptions>>;

  const peerId = await readPeerId(options.network.peerIdPath);
  options.network.discv5.enr = await readEnr(options.network.enrPath);

  const config = options.chain.name === "mainnet" ? mainnetConfig : mainnetConfig;
  const libp2p = await createNodeJsLibp2p(peerId, options.network);
  const logger = new WinstonLogger();

  const node = new BeaconNode(options, {
    config,
    libp2p,
    logger,
  });

  async function cleanup(): Promise<void> {
    await node.stop();
    await writeEnr(options.network.enrPath, options.network.discv5.enr, peerId);
  }

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  await node.start();
}
