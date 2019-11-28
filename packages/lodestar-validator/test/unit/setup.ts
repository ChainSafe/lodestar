import {initLibrary} from "@chainsafe/bls";
import {before} from "mocha";

before(async function() {
  await initLibrary();
});