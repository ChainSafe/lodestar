import fs from "node:fs";
import {IChainForkConfig} from "@lodestar/config";
import {ENR} from "@chainsafe/discv5";
import {
  BeaconNodeOptions,
  getBeaconConfigFromArgs,
  initPeerId,
  initEnr,
  readPeerId,
  readEnr,
} from "../../config/index.js";
import {defaultNetwork, IGlobalArgs, parseBeaconNodeArgs} from "../../options/index.js";
import {mkdir} from "../../util/index.js";
import {fetchBootnodes} from "../../networks/index.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {IBeaconArgs} from "../beacon/options.js";

export type ReturnType = {
  beaconNodeOptions: BeaconNodeOptions;
  config: IChainForkConfig;
};

/**
 * Initialize lodestar-cli with an on-disk configuration
 */
export async function initHandler(args: IBeaconArgs & IGlobalArgs): Promise<ReturnType> {
  const {beaconNodeOptions, config} = await initializeOptionsAndConfig(args);

  // TODO: Is it really necessary to persist ENR and PeerId?
  const network = args.network ?? config.CONFIG_NAME ?? defaultNetwork;
  await persistOptionsAndConfig(args, network);
  return {beaconNodeOptions, config};
}

export async function initializeOptionsAndConfig(args: IBeaconArgs & IGlobalArgs): Promise<ReturnType> {
  const beaconNodeOptions = new BeaconNodeOptions({
    network: args.network,
    configFile: args.configFile,
    bootnodesFile: args.bootnodesFile,
    beaconNodeOptionsCli: parseBeaconNodeArgs(args),
  });

  // Auto-setup network
  // Only download files if network.discv5.bootEnrs arg is not specified
  const bOpts = beaconNodeOptions.get();
  const bOptsEnrs = bOpts.network && bOpts.network.discv5 && bOpts.network.discv5.bootEnrs;
  if (args.network && !(bOptsEnrs && bOptsEnrs.length > 0)) {
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
export async function persistOptionsAndConfig(args: IBeaconArgs & IGlobalArgs, network: string): Promise<void> {
  const beaconPaths = getBeaconPaths(args, network);

  // initialize directories
  mkdir(beaconPaths.dataDir);
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
    let enr: ENR | null = null;
    try {
      // Note: it has happened that the ENR file gets corrupted, if that happens don't kill the node
      // https://github.com/ChainSafe/lodestar/issues/4082
      enr = readEnr(beaconPaths.enrFile);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Persisted ENR is invalid, creating a new ENR: ${(e as Error).message}`);
    }

    if (!enr) {
      initEnr(beaconPaths.enrFile, peerId);
    } else {
      const peerIdPrev = await enr.peerId();
      if (peerIdPrev.toB58String() !== peerId.toB58String()) {
        initEnr(beaconPaths.enrFile, peerId);
      }
    }
  }
}
