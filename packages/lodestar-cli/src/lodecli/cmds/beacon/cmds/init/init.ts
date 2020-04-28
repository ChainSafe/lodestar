import {Arguments} from "yargs";

import {IBeaconArgs} from "../../options";
import {mkdir} from "../../../../util";
import {initPeerId, initEnr, readPeerId} from "../../../../network";
import {initBeaconConfig} from "../../config";

/**
 * Initialize lodestar-cli with an on-disk configuration
 */
export async function init(args: Arguments<IBeaconArgs>): Promise<void> {
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
