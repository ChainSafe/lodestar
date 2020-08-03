import path from "path";
import deepmerge from "deepmerge";
import {globalOptions} from "../../../../options";
import {IBeaconOptions} from "../../options";
import {mkdir} from "../../../../util";
import {initPeerId, initEnr, readPeerId} from "../../../../network";
import {initBeaconConfig} from "../../config";
import {getTestnetConfig, getGenesisFileUrl, downloadGenesisFile, fetchBootnodes} from "../../testnets";
import {getBeaconPaths} from "../../paths";

/**
 * Initialize lodestar-cli with an on-disk configuration
 */
export async function initHandler(options: IBeaconOptions): Promise<void> {
  // Set rootDir to testnet name to separate files per network
  if (options.testnet && options.rootDir === globalOptions.rootDir.default) {
    options.rootDir = `.${options.testnet}`;
  }
  const beaconPaths = getBeaconPaths(options);

  // Auto-setup testnet
  if (options.testnet) {
    const testnetConfig = getTestnetConfig(options.testnet);
    try {
      testnetConfig.network.discv5.bootEnrs = await fetchBootnodes(options.testnet);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Error fetching latest bootnodes: ${e.stack}`);
    }
    // Mutate options so options propagate upstream to the run call
    Object.assign(options, deepmerge(options, testnetConfig));
    const genesisFileUrl = getGenesisFileUrl(options.testnet);
    if (genesisFileUrl) {
      const genesisStateFile = path.join(beaconPaths.beaconDir, "genesis.ssz");
      await downloadGenesisFile(genesisStateFile, genesisFileUrl);
      options.genesisStateFile = genesisStateFile;
      options.eth1.enabled = false;
    }
  }

  // initialize beacon directory + rootDir
  await mkdir(beaconPaths.beaconDir);
  // initialize beacon configuration file
  await initBeaconConfig(beaconPaths.configFile, options);
  // initialize beacon db path
  await mkdir(beaconPaths.dbDir);
  // initialize peer id
  await initPeerId(beaconPaths.peerIdFile);
  const peerId = await readPeerId(beaconPaths.peerIdFile);
  // initialize local enr
  await initEnr(beaconPaths.enrFile, peerId);
}
