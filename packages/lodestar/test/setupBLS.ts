import {init} from "@chainsafe/bls";

// Set minimal
if (process.env.LODESTAR_PRESET === undefined) {
  process.env.LODESTAR_PRESET = "minimal";
}

// blst-native initialization is syncronous
// Initialize bls here instead of in before() so it's available inside describe() blocks
init("blst-native").catch((e: Error) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
