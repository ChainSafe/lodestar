import {init} from "@chainsafe/bls";

export async function initBLS(): Promise<void> {
  try {
    await init("blst-native");
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("Performance warning: Using fallback wasm BLS implementation");
    await init("herumi");
  }
}
