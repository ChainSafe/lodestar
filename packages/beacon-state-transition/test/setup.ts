import {init} from "@chainsafe/bls";

// blst-native initialization is syncronous
init("blst-native").catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
