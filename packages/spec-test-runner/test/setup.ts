import {initBLS} from "@chainsafe/bls";
import {before} from "mocha";

before(async function() {
  await initBLS();
});