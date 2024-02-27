import {digest} from "@chainsafe/as-sha256";
import {allForks} from "@lodestar/types";
import {EPOCHS_PER_HISTORICAL_VECTOR} from "@lodestar/params";
import {getRandaoMix} from "../util/index.js";
import {verifyRandaoSignature} from "../signatureSets/index.js";
import {CachedBeaconStateAllForks} from "../types.js";

function xor(array1: Uint8Array, array2: Uint8Array): Uint8Array {
  const length = Math.max(array1.length, array2.length);
  const xoredArray = new Uint8Array(length);
  for (let i = 0; i < xoredArray.length; i++) {
    xoredArray[i] = array1[i] ^ array2[i];
  }
  return xoredArray;
}

/**
 * Commit a randao reveal to generate pseudorandomness seeds
 *
 * PERF: Fixed work independent of block contents.
 */
export function processRandao(
  state: CachedBeaconStateAllForks,
  block: allForks.BeaconBlock,
  verifySignature = true
): void {
  const {epochCtx} = state;
  const epoch = epochCtx.epoch;
  const randaoReveal = block.body.randaoReveal;

  // verify RANDAO reveal
  if (verifySignature) {
    if (!verifyRandaoSignature(state, block)) {
      throw new Error("RANDAO reveal is an invalid signature");
    }
  }

  // mix in RANDAO reveal
  const randaoMix = xor(getRandaoMix(state, epoch), digest(randaoReveal));
  state.randaoMixes.set(epoch % EPOCHS_PER_HISTORICAL_VECTOR, randaoMix);
}
