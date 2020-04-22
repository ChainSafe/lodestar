import * as path from "path";

import {mkdir} from "../../../../util";
import {initBeaconConfig} from "../../../../config";
import {initPeerId, initEnr, readPeerId} from "../../../../network";

/**
 * Initialize lodestar-cli with an on-disk configuration
 */
export async function init(lodestarRoot: string): Promise<void> {
  // initialize root directory
  await mkdir(lodestarRoot);
  // initialize network directory
  await mkdir(path.join(lodestarRoot, "network"));
  // initialize beacon configuration file
  await initBeaconConfig(path.join(lodestarRoot, "beacon.config"));
  // initialize peer id
  await initPeerId(path.join(lodestarRoot, "network", "peer-id"));
  const peerId = await readPeerId(path.join(lodestarRoot, "network", "peer-id"));
  // initialize local enr
  await initEnr(path.join(lodestarRoot, "network", "enr"), peerId);
}
