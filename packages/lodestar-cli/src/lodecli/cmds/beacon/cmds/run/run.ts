import * as fs from "fs";
import process from "process";
import {Arguments} from "yargs";
import deepmerge from "deepmerge";
import {initBLS} from "@chainsafe/bls";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {createIBeaconParams} from "@chainsafe/lodestar-params";
import {params as mainnetParams} from "@chainsafe/lodestar-params/lib/presets/mainnet";
import {params as minimalParams} from "@chainsafe/lodestar-params/lib/presets/minimal";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import defaultOptions, {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {WinstonLogger} from "@chainsafe/lodestar-utils";

import {readPeerId, readEnr, writeEnr} from "../../../../network";
import {IBeaconArgs} from "../../options";
import {ENR} from "@chainsafe/discv5";

/**
 * Run a beacon node
 */
export async function run(options: Arguments<IBeaconArgs & Partial<IBeaconNodeOptions>>): Promise<void> {
  await initBLS();

  options = deepmerge(defaultOptions, options) as Arguments<IBeaconArgs & Partial<IBeaconNodeOptions>>;

  const peerId = await readPeerId(options.network.peerIdFile);
  // read local enr from disk
  options.network.discv5.enr = await readEnr(options.network.enrFile);

  const config = createIBeaconConfig({
    ...(options.chain.name === "mainnet" ? mainnetParams : minimalParams),
    ...createIBeaconParams(options.chain.params || {}),
  });
  const libp2p = await createNodeJsLibp2p(peerId, options.network);
  const logger = new WinstonLogger();

  const node = new BeaconNode(options, {
    config,
    libp2p,
    logger,
  });

  async function cleanup(): Promise<void> {
    await node.stop();
    await writeEnr(options.network.enrFile, options.network.discv5.enr as ENR, peerId);
  }

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  if (options.chain.genesisStateFile) {
    await node.chain.initializeBeaconChain(
      config.types.BeaconState.tree.deserialize(await fs.promises.readFile(options.chain.genesisStateFile))
    );
  }
  await node.start();
}
