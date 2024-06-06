import {digest} from "@chainsafe/as-sha256";
import {allForks} from "@lodestar/types";
import {EPOCHS_PER_HISTORICAL_VECTOR} from "@lodestar/params";
import {getRandaoMix} from "../util/index.js";
import {verifyRandaoSignature} from "../signatureSets/index.js";
import {CachedBeaconStateAllForks} from "../types.js";

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

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    a[i] = a[i] ^ b[i];
  }
  return a;
}
