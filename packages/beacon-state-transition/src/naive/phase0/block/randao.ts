/**
 * @module chain/stateTransition/block
 */

import xor from "buffer-xor";
import {hash} from "@chainsafe/ssz";
import bls from "@chainsafe/bls";
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";

import {getBeaconProposerIndex, getCurrentEpoch, getDomain, getRandaoMix, computeSigningRoot} from "../../../util";

export function processRandao(
  config: IBeaconConfig,
  state: phase0.BeaconState,
  body: phase0.BeaconBlockBody,
  verifySignature = true
): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const proposer = state.validators[getBeaconProposerIndex(config, state)];
  const domain = getDomain(config, state, config.params.DOMAIN_RANDAO);
  const signingRoot = computeSigningRoot(config, config.types.Epoch, currentEpoch, domain);
  // Verify RANDAO reveal
  assert.true(
    !verifySignature ||
      bls.verify(proposer.pubkey.valueOf() as Uint8Array, signingRoot, body.randaoReveal.valueOf() as Uint8Array),
    "Invalid RANDAO reveal"
  );
  // Mix it in
  state.randaoMixes[currentEpoch % config.params.EPOCHS_PER_HISTORICAL_VECTOR] = xor(
    Buffer.from(getRandaoMix(config, state, currentEpoch) as Uint8Array),
    Buffer.from(hash(body.randaoReveal.valueOf() as Uint8Array))
  );
}
