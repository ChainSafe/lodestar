import {init} from "@chainsafe/bls";

before(async function () {
  await init("herumi");
});
