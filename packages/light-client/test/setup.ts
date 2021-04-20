import {init} from "@chainsafe/bls";

before(async function () {
  await init("blst-native");
});
