import path from "path";
import {Arguments} from "yargs";
import deepmerge from "deepmerge";

import {rootDir} from "../../../../options";
import {beaconDir} from "../../options/beaconDir";
import {IBeaconArgs} from "../../options";
import {mkdir} from "../../../../util";
import {initPeerId, initEnr, readPeerId} from "../../../../network";
import {initBeaconConfig} from "../../config";
import {getTestnetConfig, downloadGenesisFile} from "../../testnets";

/**
 * Initialize lodestar-cli with an on-disk configuration
 */
export async function init(args: Arguments<IBeaconArgs>): Promise<void> {
  // Auto-setup altona
  if (args.altona) {
    const altonaConfig = getTestnetConfig("altona");
    // Mutate args so options propagate upstream to the run call
    Object.assign(args, deepmerge(args, altonaConfig));
    if (args.beaconDir === beaconDir(args).default) args.beaconDir = ".altona/beacon";
    if (args.rootDir === rootDir.default) args.rootDir = ".altona";
    args.chain.genesisStateFile = path.join(args.beaconDir, "genesis.ssz");
    await downloadGenesisFile("altona", args.chain.genesisStateFile);
  }

  // initialize root directory
  await mkdir(args.rootDir);
  // initialize beacon directory
  await mkdir(args.beaconDir);
  // initialize beacon configuration file
  await initBeaconConfig(args.config, args);
  // initialize beacon db path
  await mkdir(args.dbDir);
  // initialize peer id
  await initPeerId(args.network.peerIdFile);
  const peerId = await readPeerId(args.network.peerIdFile);
  // initialize local enr
  await initEnr(args.network.enrFile, peerId);
}
