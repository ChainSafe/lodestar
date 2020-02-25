/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import xor from "buffer-xor";
import {hash} from "@chainsafe/ssz";
import {verify} from "@chainsafe/bls";

import {BeaconBlockBody, BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {DomainType} from "../constants";
import {getBeaconProposerIndex, getCurrentEpoch, getDomain, getRandaoMix,} from "../util";

export function processRandao(
  config: IBeaconConfig,
  state: BeaconState,
  body: BeaconBlockBody,
  verifySignature = true
): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const proposer = state.validators[getBeaconProposerIndex(config, state)];
  // Verify RANDAO reveal
  assert(!verifySignature || verify(
    proposer.pubkey.valueOf() as Uint8Array,
    config.types.Epoch.hashTreeRoot(currentEpoch),
    body.randaoReveal.valueOf() as Uint8Array,
    getDomain(config, state, DomainType.RANDAO),
  ));
  // Mix it in
  state.randaoMixes[currentEpoch % config.params.EPOCHS_PER_HISTORICAL_VECTOR] = xor(
    Buffer.from(getRandaoMix(config, state, currentEpoch) as Uint8Array),
    Buffer.from(hash(body.randaoReveal.valueOf() as Uint8Array)),
  );
}
