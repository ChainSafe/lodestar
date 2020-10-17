import fs from "fs";
import {IDiscv5DiscoveryInputOptions} from "@chainsafe/discv5";
import {initializeBeaconNodeOptions, processBeaconNodeOptions} from "../../config/beaconNodeOptions";
import {initializeAndWriteBeaconParams} from "../../config/beaconParams";
import {IGlobalArgs, toBeaconNodeOptions} from "../../options";
import {mkdir, joinIfRelative, downloadOrCopyFile, downloadFile} from "../../util";
import {initPeerId, initEnr, readPeerId} from "../../network";
import {getGenesisFileUrl, fetchBootnodes, getTestnetParamsUrl} from "../../testnets";
import {getBeaconPaths} from "../beacon/paths";
import {IBeaconArgs} from "../beacon/options";

/**
 * Handler runable from other commands
 */
export async function initCmd(options: IGlobalArgs): Promise<void> {
  await initHandler(options as IBeaconArgs & IGlobalArgs);
}

/**
 * Initialize lodestar-cli with an on-disk configuration
 */
export async function initHandler(args: IBeaconArgs & IGlobalArgs): Promise<void> {
  const beaconPaths = getBeaconPaths(args);
  const beaconNodeOptions = processBeaconNodeOptions({
    beaconNodeArgs: toBeaconNodeOptions(args),
    configFile: beaconPaths.configFile,
    testnet: args.testnet,
  });

  // Auto-setup testnet
  // Only download files if params file does not exist
  if (args.testnet && !fs.existsSync(beaconPaths.paramsFile)) {
    try {
      if (!beaconNodeOptions.network) beaconNodeOptions.network = {};
      if (!beaconNodeOptions.network.discv5) beaconNodeOptions.network.discv5 = {} as IDiscv5DiscoveryInputOptions;
      beaconNodeOptions.network.discv5.bootEnrs = await fetchBootnodes(args.testnet);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Error fetching latest bootnodes: ${e.stack}`);
    }

    // Mutate options so options will be written to disk in beacon configuration file
    if (!args.genesisStateFile) {
      args.genesisStateFile = getGenesisFileUrl(args.testnet);
    }

    // testnet params
    const paramsUrl = getTestnetParamsUrl(args.testnet);
    if (paramsUrl) {
      await downloadFile(beaconPaths.paramsFile, paramsUrl);
    }
  }

  // Weak subjectivity and genesis state
  const weakSubjectivityStateFilePath = joinIfRelative(beaconPaths.beaconDir, "weakSubjectivityState.ssz");
  const genesisStateFilePath = joinIfRelative(beaconPaths.beaconDir, "genesis.ssz");
  if (args.weakSubjectivityStateFile) {
    await downloadOrCopyFile(weakSubjectivityStateFilePath, args.weakSubjectivityStateFile);
    options.weakSubjectivityStateFile = weakSubjectivityStateFilePath;
  } else if (args.genesisStateFile) {
    await downloadOrCopyFile(genesisStateFilePath, args.genesisStateFile);
    options.genesisStateFile = genesisStateFilePath;
    options.eth1.enabled = false;
  }

  // initialize directories
  await mkdir(beaconPaths.rootDir);
  await mkdir(beaconPaths.beaconDir);
  await mkdir(beaconPaths.dbDir);

  // initialize params file, if it doesn't exist
  if (!fs.existsSync(beaconPaths.paramsFile)) {
    await initializeAndWriteBeaconParams({
      paramsFile: beaconPaths.paramsFile,
      preset: args.preset,
      testnet: args.testnet,
      additionalParams: args.params,
    });
  }

  // initialize beacon configuration file, if it doesn't exist
  if (!fs.existsSync(beaconPaths.configFile)) {
    await initializeBeaconNodeOptions(beaconPaths.configFile, beaconNodeOptions);
  }

  // initialize peer id & ENR, if either doesn't exist
  if (!fs.existsSync(beaconPaths.peerIdFile) || !fs.existsSync(beaconPaths.enrFile)) {
    await initPeerId(beaconPaths.peerIdFile);
    const peerId = await readPeerId(beaconPaths.peerIdFile);
    // initialize local enr
    await initEnr(beaconPaths.enrFile, peerId);
  }
}
