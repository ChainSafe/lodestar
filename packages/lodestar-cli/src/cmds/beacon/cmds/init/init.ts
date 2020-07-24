import path from "path";
import deepmerge from "deepmerge";
import {globalOptions} from "../../../../options";
import {IBeaconOptions} from "../../options";
import {mkdir} from "../../../../util";
import {initPeerId, initEnr, readPeerId} from "../../../../network";
import {initBeaconConfig} from "../../config";
import {getTestnetConfig, downloadGenesisFile, fetchBootnodes} from "../../testnets";
import {getBeaconPaths} from "../../paths";

/**
 * Initialize lodestar-cli with an on-disk configuration
 */
export async function initHandler(args: IBeaconOptions): Promise<void> {
  // Set rootDir to testnet name to separate files per network
  if (args.testnet && args.rootDir === globalOptions.rootDir.default) {
    args.rootDir = `.${args.testnet}`;
  }
  const beaconPaths = getBeaconPaths(args);

  // Auto-setup testnet
  if (args.testnet) {
    const testnetConfig = getTestnetConfig(args.testnet);
    try {
      testnetConfig.network.discv5.bootEnrs = await fetchBootnodes(args.testnet);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Error fetching latest bootnodes: ${e.stack}`);
    }
    // Mutate args so options propagate upstream to the run call
    Object.assign(args, deepmerge(args, testnetConfig));
    args.chain.genesisStateFile = path.join(beaconPaths.beaconDir, "genesis.ssz");
    await downloadGenesisFile(args.testnet, args.chain.genesisStateFile);
  }

  // initialize beacon directory + rootDir
  await mkdir(beaconPaths.beaconDir);
  // initialize beacon configuration file
  await initBeaconConfig(beaconPaths.configFile, args);
  // initialize beacon db path
  await mkdir(beaconPaths.dbDir);
  // initialize peer id
  await initPeerId(beaconPaths.network.peerIdFile);
  const peerId = await readPeerId(beaconPaths.network.peerIdFile);
  // initialize local enr
  await initEnr(beaconPaths.network.enrFile, peerId);
}
