/**
 * @module chain/stateTransition/block
 */

import xor from "buffer-xor";
import {hash} from "@chainsafe/ssz";
import bls from "@chainsafe/bls";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";

import {getBeaconProposerIndex, getCurrentEpoch, getDomain, getRandaoMix, computeSigningRoot} from "../../../util";
import {DOMAIN_RANDAO, EPOCHS_PER_HISTORICAL_VECTOR} from "@chainsafe/lodestar-params";

export function processRandao(state: phase0.BeaconState, body: phase0.BeaconBlockBody, verifySignature = true): void {
  const currentEpoch = getCurrentEpoch(state);
  const proposer = state.validators[getBeaconProposerIndex(state)];
  const domain = getDomain(state, DOMAIN_RANDAO);
  const signingRoot = computeSigningRoot(ssz.Epoch, currentEpoch, domain);
  // Verify RANDAO reveal
  assert.true(
    !verifySignature ||
      bls.verify(proposer.pubkey.valueOf() as Uint8Array, signingRoot, body.randaoReveal.valueOf() as Uint8Array),
    "Invalid RANDAO reveal"
  );
  // Mix it in
  state.randaoMixes[currentEpoch % EPOCHS_PER_HISTORICAL_VECTOR] = xor(
    Buffer.from(getRandaoMix(state, currentEpoch) as Uint8Array),
    Buffer.from(hash(body.randaoReveal.valueOf() as Uint8Array))
  );
}
