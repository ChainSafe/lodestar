import xor from "buffer-xor";
import {hash} from "@chainsafe/ssz";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {getRandaoMix} from "../../../util";
import {CachedBeaconState, verifyRandaoSignature} from "../../../fast";

export function processRandao(
  state: CachedBeaconState<phase0.BeaconState>,
  block: phase0.BeaconBlock,
  verifySignature = true
): void {
  const {config, epochCtx} = state;
  const epoch = epochCtx.currentShuffling.epoch;
  const randaoReveal = block.body.randaoReveal.valueOf() as Uint8Array;

  // verify RANDAO reveal
  if (verifySignature) {
    if (!verifyRandaoSignature(state as CachedBeaconState<allForks.BeaconState>, block)) {
      throw new Error("RANDAO reveal is an invalid signature");
    }
  }

  // mix in RANDAO reveal
  state.randaoMixes[epoch % config.params.EPOCHS_PER_HISTORICAL_VECTOR] = xor(
    Buffer.from(getRandaoMix(config, state, epoch) as Uint8Array),
    Buffer.from(hash(randaoReveal))
  );
}
