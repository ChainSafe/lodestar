import yargs from "yargs";
import {createPeerId} from "../network/util";
import {savePeerId} from "../network/nodejs/util";

const args = yargs.parse()._;
const filename = args[0];

(async function() {
  const peerId = await createPeerId();
  await savePeerId(filename, peerId);
})()
