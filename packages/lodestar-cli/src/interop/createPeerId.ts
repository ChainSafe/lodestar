import yargs from "yargs";
import {createPeerId} from "@chainsafe/lodestar/lib/network/util";
import {savePeerId} from "@chainsafe/lodestar/lib/network/nodejs/util";

const args = yargs.parse()._;
const filename = args[0];

(async function() {
  const peerId = await createPeerId();
  await savePeerId(filename, peerId);
})();
