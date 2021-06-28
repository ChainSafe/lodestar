import {init} from "@chainsafe/bls";

// Set minimal
if (process.env.LODESTAR_PRESET === undefined) {
  process.env.LODESTAR_PRESET = "minimal";
}

// blst-native initialization is syncronous
init("blst-native").catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
