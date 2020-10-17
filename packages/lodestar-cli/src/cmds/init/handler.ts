import fs from "fs";
import {BeaconNodeOptions} from "../../config/beaconNodeOptions";
import {getBeaconConfig, writeBeaconParams} from "../../config/beaconParams";
import {IGlobalArgs, toBeaconNodeOptions} from "../../options";
import {mkdir, joinIfRelative, downloadOrCopyFile} from "../../util";
import {initPeerId, initEnr, readPeerId} from "../../network";
import {getGenesisFileUrl, fetchBootnodes} from "../../testnets";
import {getBeaconPaths} from "../beacon/paths";
import {IBeaconArgs} from "../beacon/options";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

/**
 * Initialize lodestar-cli with an on-disk configuration
 */
export async function initHandler(args: IBeaconArgs & IGlobalArgs): Promise<void> {
  const {beaconNodeOptions, config} = await initializeOptionsAndConfig(args);
  await persistOptionsAndConfig(args, beaconNodeOptions, config);
}

export async function initializeOptionsAndConfig(
  args: IBeaconArgs & IGlobalArgs
): Promise<{
  beaconNodeOptions: BeaconNodeOptions;
  config: IBeaconConfig;
}> {
  const beaconPaths = getBeaconPaths(args);
  const beaconNodeOptions = new BeaconNodeOptions({
    beaconNodeArgs: toBeaconNodeOptions(args),
    configFile: beaconPaths.configFile,
    testnet: args.testnet,
  });

  // Auto-setup testnet
  // Only download files if params file does not exist
  if (args.testnet && !fs.existsSync(beaconPaths.paramsFile)) {
    try {
      const bootEnrs = await fetchBootnodes(args.testnet);
      beaconNodeOptions.set({network: {discv5: {bootEnrs}}});
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Error fetching latest bootnodes: ${e.stack}`);
    }

    // Mutate options so options will be written to disk in beacon configuration file
    const genesisFileUrl = getGenesisFileUrl(args.testnet);
    if (!args.genesisStateFile && genesisFileUrl) {
      args.genesisStateFile = genesisFileUrl;
    }
  }

  // Weak subjectivity and genesis state
  if (args.weakSubjectivityStateFile) {
    const weakSubjectivityStateFilePath = joinIfRelative(beaconPaths.beaconDir, "weakSubjectivityState.ssz");
    await downloadOrCopyFile(weakSubjectivityStateFilePath, args.weakSubjectivityStateFile);
    args.weakSubjectivityStateFile = weakSubjectivityStateFilePath;
  } else if (args.genesisStateFile) {
    const genesisStateFilePath = joinIfRelative(beaconPaths.beaconDir, "genesis.ssz");
    await downloadOrCopyFile(genesisStateFilePath, args.genesisStateFile);
    args.genesisStateFile = genesisStateFilePath;
    beaconNodeOptions.set({eth1: {enabled: false}});
  }

  // initialize params file, if it doesn't exist
  const config = getBeaconConfig({
    paramsFile: beaconPaths.paramsFile,
    preset: args.preset,
    testnet: args.testnet,
    additionalParamsCli: args.params,
  });

  return {beaconNodeOptions, config};
}

export async function persistOptionsAndConfig(
  args: IBeaconArgs & IGlobalArgs,
  beaconNodeOptions: BeaconNodeOptions,
  beaconConfig: IBeaconConfig
): Promise<void> {
  const beaconPaths = getBeaconPaths(args);

  // initialize directories
  mkdir(beaconPaths.rootDir);
  mkdir(beaconPaths.beaconDir);
  mkdir(beaconPaths.dbDir);

  // initialize peer id & ENR, if either doesn't exist
  if (!fs.existsSync(beaconPaths.peerIdFile) || !fs.existsSync(beaconPaths.enrFile)) {
    await initPeerId(beaconPaths.peerIdFile);
    const peerId = await readPeerId(beaconPaths.peerIdFile);
    // initialize local enr
    await initEnr(beaconPaths.enrFile, peerId);
  }

  if (!fs.existsSync(beaconPaths.paramsFile)) {
    writeBeaconParams(beaconPaths.paramsFile, beaconConfig.params);
  }

  // initialize beacon configuration file, if it doesn't exist
  if (!fs.existsSync(beaconPaths.configFile)) {
    beaconNodeOptions.writeTo(beaconPaths.configFile);
  }
}
