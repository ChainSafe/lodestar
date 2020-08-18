import xor from "buffer-xor";
import {hash} from "@chainsafe/ssz";
import {BeaconBlockBody, BeaconState} from "@chainsafe/lodestar-types";
import {Signature} from "@chainsafe/bls";

import {DomainType} from "../../constants";
import {computeSigningRoot, getDomain, getRandaoMix} from "../../util";
import {EpochContext} from "../util";


export function processRandao(
  epochCtx: EpochContext,
  state: BeaconState,
  body: BeaconBlockBody,
  verifySignature = true,
): void {
  const config = epochCtx.config;
  const epoch = epochCtx.currentShuffling.epoch;
  const randaoReveal = body.randaoReveal.valueOf() as Uint8Array;
  // verify RANDAO reveal
  if (verifySignature) {
    const proposerIndex = epochCtx.getBeaconProposer(state.slot);
    const proposerPubkey = epochCtx.index2pubkey[proposerIndex];
    const signingRoot = computeSigningRoot(
      config,
      config.types.Epoch,
      epoch,
      getDomain(config, state, DomainType.RANDAO)
    );
    if (!proposerPubkey.verifyMessage(Signature.fromCompressedBytes(randaoReveal), signingRoot)) {
      throw new Error("RANDAO reveal is an invalid signature");
    }
  }
  // mix in RANDAO reveal
  state.randaoMixes[epoch % config.params.EPOCHS_PER_HISTORICAL_VECTOR] = xor(
    Buffer.from(getRandaoMix(config, state, epoch) as Uint8Array),
    Buffer.from(hash(randaoReveal)),
  );
}
