import fs from "node:fs";
import PeerId from "peer-id";
import {IChainForkConfig} from "@lodestar/config";
import {
  BeaconNodeOptions,
  getBeaconConfigFromArgs,
  initPeerId,
  initEnr,
  readPeerId,
  readEnr,
  FileENR,
  overwriteEnrWithCliArgs,
} from "../../config/index.js";
import {IGlobalArgs, parseBeaconNodeArgs, parseEnrArgs} from "../../options/index.js";
import {mkdir} from "../../util/index.js";
import {fetchBootnodes} from "../../networks/index.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {IBeaconArgs} from "../beacon/options.js";
import {getVersionData} from "../../util/version.js";

export type ReturnType = {
  beaconNodeOptions: BeaconNodeOptions;
  config: IChainForkConfig;
  peerId: PeerId;
};

/**
 * Initialize lodestar-cli with an on-disk configuration
 */
export async function initHandler(args: IBeaconArgs & IGlobalArgs): Promise<ReturnType> {
  const {beaconNodeOptions, config, peerId} = await initializeOptionsAndConfig(args);
  return {beaconNodeOptions, config, peerId};
}

export async function initializeOptionsAndConfig(args: IBeaconArgs & IGlobalArgs): Promise<ReturnType> {
  const beaconPaths = getBeaconPaths(args);

  // initialize directories
  mkdir(beaconPaths.dataDir);
  mkdir(beaconPaths.beaconDir);
  mkdir(beaconPaths.dbDir);

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

  const {version, commit} = getVersionData();
  // TODO: Rename db.name to db.path or db.location
  beaconNodeOptions.set({db: {name: beaconPaths.dbDir}});
  beaconNodeOptions.set({chain: {persistInvalidSszObjectsDir: beaconPaths.persistInvalidSszObjectsDir}});
  // Add metrics metadata to show versioning + network info in Prometheus + Grafana
  beaconNodeOptions.set({metrics: {metadata: {version, commit, network: args.network}}});
  // Add detailed version string for API node/version endpoint
  beaconNodeOptions.set({api: {version}});

  // ENR setup

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

  const enr = FileENR.initFromFile(beaconPaths.enrFile, peerId);
  const enrArgs = parseEnrArgs(args);
  overwriteEnrWithCliArgs(enr, enrArgs, beaconNodeOptions.getWithDefaults());
  const enrUpdate = !enrArgs.ip && !enrArgs.ip6;
  beaconNodeOptions.set({network: {discv5: {enr, enrUpdate}}});

  // initialize params file, if it doesn't exist
  const config = getBeaconConfigFromArgs(args);

  return {beaconNodeOptions, config, peerId};
}
