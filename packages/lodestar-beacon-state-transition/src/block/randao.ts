/**
 * @module chain/stateTransition/block
 */

import xor from "buffer-xor";
import {hash} from "@chainsafe/ssz";
import {verify} from "@chainsafe/bls";
import {BeaconBlockBody, BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";

import {DomainType} from "../constants";
import {getBeaconProposerIndex, getCurrentEpoch, getDomain, getRandaoMix,} from "../util";
import {computeSigningRoot} from "../util/signingRoot";

export function processRandao(
  config: IBeaconConfig,
  state: BeaconState,
  body: BeaconBlockBody,
  verifySignature = true
): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const proposer = state.validators[getBeaconProposerIndex(config, state)];
  const domain = getDomain(config, state, DomainType.RANDAO);
  const signingRoot = computeSigningRoot(config, config.types.Epoch, currentEpoch, domain);
  // Verify RANDAO reveal
  assert(!verifySignature || verify(
    proposer.pubkey.valueOf() as Uint8Array,
    signingRoot,
    body.randaoReveal.valueOf() as Uint8Array,
  ));
  // Mix it in
  state.randaoMixes[currentEpoch % config.params.EPOCHS_PER_HISTORICAL_VECTOR] = xor(
    Buffer.from(getRandaoMix(config, state, currentEpoch) as Uint8Array),
    Buffer.from(hash(body.randaoReveal.valueOf() as Uint8Array)),
  );
}
