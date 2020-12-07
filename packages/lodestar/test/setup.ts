import {init} from "@chainsafe/bls";
import {before} from "mocha";

before(async function () {
  try {
    await init("blst-native");
  } catch (e) {
    console.log(e);
  }
});
