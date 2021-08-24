import fs from "fs";
import {
  BeaconNodeOptions,
  getBeaconConfigFromArgs,
  writeBeaconParams,
  initPeerId,
  initEnr,
  readPeerId,
  readEnr,
} from "../../config";
import {IGlobalArgs, parseBeaconNodeArgs} from "../../options";
import {mkdir} from "../../util";
import {fetchBootnodes} from "../../networks";
import {getBeaconPaths} from "../beacon/paths";
import {IBeaconArgs} from "../beacon/options";
import {IChainForkConfig} from "@chainsafe/lodestar-config";

export type ReturnType = {
  beaconNodeOptions: BeaconNodeOptions;
  config: IChainForkConfig;
};

/**
 * Initialize lodestar-cli with an on-disk configuration
 */
export async function initHandler(args: IBeaconArgs & IGlobalArgs): Promise<ReturnType> {
  const {beaconNodeOptions, config} = await initializeOptionsAndConfig(args);
  await persistOptionsAndConfig(args, config);
  return {beaconNodeOptions, config};
}

export async function initializeOptionsAndConfig(args: IBeaconArgs & IGlobalArgs): Promise<ReturnType> {
  const beaconPaths = getBeaconPaths(args);
  const beaconNodeOptions = new BeaconNodeOptions({
    network: args.network || "mainnet",
    beaconNodeOptionsCli: parseBeaconNodeArgs(args),
  });

  // Auto-setup network
  // Only download files if params file does not exist
  if (args.network && !fs.existsSync(beaconPaths.paramsFile)) {
    try {
      const bootEnrs = await fetchBootnodes(args.network);
      beaconNodeOptions.set({network: {discv5: {bootEnrs}}});
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Error fetching latest bootnodes: ${(e as Error).stack}`);
    }
  }

  // initialize params file, if it doesn't exist
  const config = getBeaconConfigFromArgs(args);

  return {beaconNodeOptions, config};
}

/**
 * Write options and configs to disk
 */
export async function persistOptionsAndConfig(
  args: IBeaconArgs & IGlobalArgs,
  beaconConfig: IChainForkConfig
): Promise<void> {
  const beaconPaths = getBeaconPaths(args);

  // initialize directories
  mkdir(beaconPaths.rootDir);
  mkdir(beaconPaths.beaconDir);
  mkdir(beaconPaths.dbDir);

  // Initialize peerId if does not exist
  if (!fs.existsSync(beaconPaths.peerIdFile)) {
    await initPeerId(beaconPaths.peerIdFile);
  }

  const peerId = await readPeerId(beaconPaths.peerIdFile);

  // Initialize ENR if does not exist
  if (!fs.existsSync(beaconPaths.enrFile)) {
    initEnr(beaconPaths.enrFile, peerId);
  } else {
    // Verify that the peerId matches the ENR
    const enr = readEnr(beaconPaths.enrFile);
    const peerIdPrev = await enr.peerId();
    if (peerIdPrev.toB58String() !== peerId.toB58String()) {
      initEnr(beaconPaths.enrFile, peerId);
    }
  }

  if (!fs.existsSync(beaconPaths.paramsFile)) {
    writeBeaconParams(beaconPaths.paramsFile, beaconConfig);
  }
}
