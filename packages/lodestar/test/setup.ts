import {init} from "@chainsafe/bls";
import {before} from "mocha";

before(async function () {
  await init("blst-native");
});
