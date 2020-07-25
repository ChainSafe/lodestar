import * as fs from "fs";
import process from "process";
import {initBLS} from "@chainsafe/bls";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {createIBeaconParams} from "@chainsafe/lodestar-params";
import {params as mainnetParams} from "@chainsafe/lodestar-params/lib/presets/mainnet";
import {params as minimalParams} from "@chainsafe/lodestar-params/lib/presets/minimal";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {IBeaconOptions} from "../../options";
import {readPeerId, readEnr, writeEnr} from "../../../../network";
import {ENR} from "@chainsafe/discv5";
import {initHandler as initBeacon} from "../init/init";
import {getBeaconPaths} from "../../paths";
import {mergeConfigOptions} from "../../config";

/**
 * Run a beacon node
 */
export async function runHandler(options: IBeaconOptions): Promise<void> {
  await initBLS();

  // Auto-setup testnet
  if (options.testnet) {
    await initBeacon(options);
  }

  options = mergeConfigOptions(options);
  const beaconPaths = getBeaconPaths(options);

  const peerId = await readPeerId(beaconPaths.peerIdFile);
  // read local enr from disk
  options.network.discv5.enr = await readEnr(beaconPaths.enrFile);

  const config = createIBeaconConfig({
    ...(options.chain.name === "mainnet" ? mainnetParams : minimalParams),
    ...createIBeaconParams(options.chain.params || {}),
  });
  const libp2p = await createNodeJsLibp2p(peerId, options.network);
  const logger = new WinstonLogger();

  const node = new BeaconNode(options, {config, libp2p, logger});

  async function cleanup(): Promise<void> {
    await node.stop();
    await writeEnr(beaconPaths.enrFile, options.network.discv5.enr as ENR, peerId);
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
