import {digest} from "@chainsafe/as-sha256";
import {DOMAIN_RANDAO, EPOCHS_PER_HISTORICAL_VECTOR, ForkBls, ForkName, ForkSeq} from "@lodestar/params";
import {BeaconBlock} from "@lodestar/types";
import {xor} from "@lodestar/utils";
import {verifyRandaoSignature} from "../signatureSets/index.js";
import {CachedBeaconStateAllForks, CachedBeaconStatePq} from "../types.js";
import {getRandaoMix} from "../util/index.js";
import {isValidVrfProof} from "../util/pq.js";

/**
 * Commit a randao reveal to generate pseudorandomness seeds
 *
 * PERF: Fixed work independent of block contents.
 */
export function processRandao(state: CachedBeaconStateAllForks, block: BeaconBlock, verifySignature = true): void {
  const {epochCtx, config} = state;
  const epoch = epochCtx.epoch;

  // From pq the reveal is a leaf of the tree under the proposer's VRF root, which the proposer
  // committed to before it knew the slot's randomness. Checking it is hashing, not a signature.
  if (config.getForkSeq(block.slot) === ForkSeq.pq) {
    const reveal = (block as BeaconBlock<ForkName.pq>).body.randaoReveal;
    const proposer = (state as CachedBeaconStatePq).validators.getReadonly(block.proposerIndex);
    if (!isValidVrfProof(proposer.vrfRoot, state.slot, reveal)) {
      throw new Error("RANDAO reveal is an invalid VRF proof");
    }
    const input = new Uint8Array(68);
    input.set(getRandaoMix(state, epoch), 0);
    input.set(reveal[0], 32);
    input.set(DOMAIN_RANDAO, 64);
    state.randaoMixes.set(epoch % EPOCHS_PER_HISTORICAL_VECTOR, digest(input));
    return;
  }

  const blsBlock = block as BeaconBlock<ForkBls>;
  const randaoReveal = blsBlock.body.randaoReveal;

  // verify RANDAO reveal
  if (verifySignature && !verifyRandaoSignature(config, blsBlock)) {
    throw new Error("RANDAO reveal is an invalid signature");
  }

  // mix in RANDAO reveal
  const randaoMix = xor(getRandaoMix(state, epoch), digest(randaoReveal));
  state.randaoMixes.set(epoch % EPOCHS_PER_HISTORICAL_VECTOR, randaoMix);
}
