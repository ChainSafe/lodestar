import * as path from "path";

import {mkdir} from "../../lodestar/util";
import {initConfig} from "../../config";
import {initPeerId, initEnr, readPeerId} from "../../network";

/**
 * Initialize lodestar-cli with an on-disk configuration
 */
export async function init(lodestarRoot: string): Promise<void> {
  // initialize root directory
  await mkdir(lodestarRoot);
  // initialize network directory
  await mkdir(path.join(lodestarRoot, "network"));
  // initialize main configuration file
  await initConfig(path.join(lodestarRoot, "lodestar.config"));
  // initialize peer id
  await initPeerId(path.join(lodestarRoot, "network", "peer-id"));
  const peerId = await readPeerId(path.join(lodestarRoot, "network", "peer-id"));
  // initialize local enr
  await initEnr(path.join(lodestarRoot, "network", "enr"), peerId);
}
