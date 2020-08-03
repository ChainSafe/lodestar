import * as fs from "fs";
import path from "path";
import deepmerge from "deepmerge";
import {IInitOptions} from "./options";
import {initBeaconConfig} from "../../config/beacon";
import {mkdir, getBeaconConfig} from "../../util";
import {initPeerId, initEnr, readPeerId} from "../../network";
import {getTestnetConfig, getGenesisFileUrl, downloadFile, fetchBootnodes, getTestnetParamsUrl} from "../../testnets";
import {writeParamsConfig} from "../../config/params";
import {getBeaconPaths} from "../beacon/paths";

/**
 * Initialize lodestar-cli with an on-disk configuration
 */
export async function initHandler(options: IInitOptions): Promise<void> {
  options = {
    ...options,
    ...getBeaconPaths(options),
  };

  // Auto-setup testnet
  // Only download files if params file does not exist
  if (options.testnet && !fs.existsSync(options.paramsFile)) {
    const testnetConfig = getTestnetConfig(options.testnet);
    try {
      testnetConfig.network.discv5.bootEnrs = await fetchBootnodes(options.testnet);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Error fetching latest bootnodes: ${e.stack}`);
    }
    // Mutate options so options will be written to disk in beacon configuration file
    Object.assign(options, deepmerge(options, testnetConfig));
    const genesisFileUrl = getGenesisFileUrl(options.testnet);
    if (genesisFileUrl) {
      const genesisStateFile = path.join(options.beaconDir, "genesis.ssz");
      options.genesisStateFile = genesisStateFile;
      await downloadFile(options.genesisStateFile, genesisFileUrl);
      options.eth1.enabled = false;
    }

    // testnet params
    const paramsUrl = getTestnetParamsUrl(options.testnet);
    if (paramsUrl) {
      await downloadFile(options.paramsFile, paramsUrl);
    }
  }

  // initialize rootDir
  await mkdir(options.rootDir);
  // initialize params file -- if it doesn't exist
  if (!fs.existsSync(options.paramsFile)) {
    const config = getBeaconConfig(options.preset, options.params);
    await writeParamsConfig(options.paramsFile, config);
  }
  // initialize beacon directory
  await mkdir(options.beaconDir);
  // initialize beacon configuration file -- if it doesn't exist
  if (!fs.existsSync(options.configFile)) {
    await initBeaconConfig(options.configFile, options);
  }
  // initialize beacon db path
  await mkdir(options.dbDir);
  // initialize peer id & ENR -- if either doesn't exist
  if (!fs.existsSync(options.peerIdFile) || !fs.existsSync(options.enrFile)) {
    await initPeerId(options.peerIdFile);
    const peerId = await readPeerId(options.peerIdFile);
    // initialize local enr
    await initEnr(options.enrFile, peerId);
  }
}
