/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import xor from "buffer-xor";
import {hash} from "@chainsafe/ssz";
import {verify} from "@chainsafe/bls";

import {BeaconBlockBody, BeaconState} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {DomainType} from "../constants";
import {getBeaconProposerIndex, getCurrentEpoch, getDomain, getRandaoMix,} from "../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.8.1/specs/core/0_beacon-chain.md#randao

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
    proposer.pubkey,
    config.types.Epoch.hashTreeRoot(currentEpoch),
    body.randaoReveal,
    getDomain(config, state, DomainType.RANDAO),
  ));
  // Mix it in
  state.randaoMixes[currentEpoch % config.params.EPOCHS_PER_HISTORICAL_VECTOR] = xor(
    Buffer.from(getRandaoMix(config, state, currentEpoch) as Uint8Array),
    Buffer.from(hash(Buffer.from(body.randaoReveal as Uint8Array)))
  );
}
