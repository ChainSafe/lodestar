import fs from "node:fs";
import {BeaconNodeOptions, getBeaconConfigFromArgs, initPeerId, initEnr, readPeerId, readEnr} from "../../config";
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
  await persistOptionsAndConfig(args);
  return {beaconNodeOptions, config};
}

export async function initializeOptionsAndConfig(args: IBeaconArgs & IGlobalArgs): Promise<ReturnType> {
  const beaconPaths = getBeaconPaths(args);

  const beaconNodeOptions = new BeaconNodeOptions({
    network: args.network || "mainnet",
    configFile: beaconPaths.configFile,
    bootnodesFile: beaconPaths.bootnodesFile,
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

  // Apply port option
  if (args.port !== undefined) {
    beaconNodeOptions.set({network: {localMultiaddrs: [`/ip4/0.0.0.0/tcp/${args.port}`]}});
    const discoveryPort = args.discoveryPort ?? args.port;
    beaconNodeOptions.set({network: {discv5: {bindAddr: `/ip4/0.0.0.0/udp/${discoveryPort}`}}});
  } else if (args.discoveryPort !== undefined) {
    beaconNodeOptions.set({network: {discv5: {bindAddr: `/ip4/0.0.0.0/udp/${args.discoveryPort}`}}});
  }

  // initialize params file, if it doesn't exist
  const config = getBeaconConfigFromArgs(args);

  return {beaconNodeOptions, config};
}

/**
 * Write options and configs to disk
 */
export async function persistOptionsAndConfig(args: IBeaconArgs & IGlobalArgs): Promise<void> {
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
}
