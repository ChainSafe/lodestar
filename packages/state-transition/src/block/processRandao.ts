import {digest} from "@chainsafe/as-sha256";
import {EPOCHS_PER_HISTORICAL_VECTOR} from "@lodestar/params";
import {BeaconBlock} from "@lodestar/types";
import {xor} from "@lodestar/utils";
import {verifyRandaoSignature} from "../signatureSets/index.js";
import {CachedBeaconStateAllForks} from "../types.js";
import {getRandaoMix} from "../util/index.js";

/**
 * Commit a randao reveal to generate pseudorandomness seeds
 *
 * PERF: Fixed work independent of block contents.
 */
export function processRandao(state: CachedBeaconStateAllForks, block: BeaconBlock, verifySignature = true): void {
  const {epochCtx} = state;
  const epoch = epochCtx.epoch;
  const randaoReveal = block.body.randaoReveal;

  // verify RANDAO reveal
  if (verifySignature && !verifyRandaoSignature(state, block)) {
    throw new Error("RANDAO reveal is an invalid signature");
  }

  // mix in RANDAO reveal
  const randaoMix = xor(getRandaoMix(state, epoch), digest(randaoReveal));
  state.randaoMixes.set(epoch % EPOCHS_PER_HISTORICAL_VECTOR, randaoMix);
}
