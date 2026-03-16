import {beforeAll, describe, expect, it} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import {
  BeaconStateAllForks,
  BeaconStateView,
  createCachedBeaconState,
  createPubkeyCache,
} from "@lodestar/state-transition";
import {BLSPubkey, ValidatorIndex, ssz} from "@lodestar/types";
import {getPubkeysForIndices} from "../../../../../src/api/impl/validator/utils.js";

describe("api / impl / validator / utils", () => {
  const vc = 32;

  const pubkeys: BLSPubkey[] = [];
  const indexes: ValidatorIndex[] = [];
  let state: BeaconStateAllForks;
  beforeAll(() => {
    state = ssz.phase0.BeaconState.defaultViewDU();
    const validator = ssz.phase0.Validator.defaultValue();
    const validators = state.validators;
    for (let i = 0; i < vc; i++) {
      indexes.push(i);
      const pubkey = Buffer.alloc(48, i);
      pubkeys.push(pubkey);
      validators.push(ssz.phase0.Validator.toViewDU({...validator, pubkey}));
    }
    state.commit();
  });

  it("getPubkeysForIndices", () => {
    const cachedState = createCachedBeaconState(
      state,
      {
        config: createBeaconConfig(defaultChainConfig, state.genesisValidatorsRoot),
        pubkeyCache: createPubkeyCache(),
      },
      {skipSyncPubkeys: true}
    );
    const pubkeysRes = getPubkeysForIndices(new BeaconStateView(cachedState), indexes);
    expect(pubkeysRes.map(toHexString)).toEqual(pubkeys.map(toHexString));
  });
});
