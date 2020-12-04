import xor from "buffer-xor";
import {hash} from "@chainsafe/ssz";
import {BeaconBlockBody, BeaconState} from "@chainsafe/lodestar-types";
import {DomainType} from "../../constants";
import {computeSigningRoot, getDomain, getRandaoMix} from "../../util";
import {EpochContext} from "../util";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../signatureSets";

export function processRandao(
  epochCtx: EpochContext,
  state: BeaconState,
  body: BeaconBlockBody,
  verifySignature = true
): void {
  const config = epochCtx.config;
  const epoch = epochCtx.currentShuffling.epoch;
  const randaoReveal = body.randaoReveal.valueOf() as Uint8Array;

  // verify RANDAO reveal
  if (verifySignature) {
    const signatureSet = getRandaoRevealSignatureSet(epochCtx, state, body);
    if (!verifySignatureSet(signatureSet)) {
      throw new Error("RANDAO reveal is an invalid signature");
    }
  }

  // mix in RANDAO reveal
  state.randaoMixes[epoch % config.params.EPOCHS_PER_HISTORICAL_VECTOR] = xor(
    Buffer.from(getRandaoMix(config, state, epoch) as Uint8Array),
    Buffer.from(hash(randaoReveal))
  );
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getRandaoRevealSignatureSet(
  epochCtx: EpochContext,
  state: BeaconState,
  body: BeaconBlockBody
): ISignatureSet {
  const config = epochCtx.config;
  const epoch = epochCtx.currentShuffling.epoch;
  const proposerIndex = epochCtx.getBeaconProposer(state.slot);
  const domain = getDomain(config, state, DomainType.RANDAO);

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[proposerIndex],
    signingRoot: computeSigningRoot(config, config.types.Epoch, epoch, domain),
    signature: body.randaoReveal,
  };
}
