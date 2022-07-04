import {expect} from "chai";
import {toHexString} from "@chainsafe/ssz";
import {BLSPubkey, ssz, ValidatorIndex} from "@lodestar/types";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {getPubkeysForIndices} from "../../../../../src/api/impl/validator/utils.js";

describe("api / impl / validator / utils", () => {
  const vc = 32;

  const pubkeys: BLSPubkey[] = [];
  const indexes: ValidatorIndex[] = [];
  let state: BeaconStateAllForks;
  before("Prepare state", () => {
    state = ssz.phase0.BeaconState.defaultViewDU();
    const validator = ssz.phase0.Validator.defaultValue();
    const validators = state.validators;
    for (let i = 0; i < vc; i++) {
      indexes.push(i);
      const pubkey = Buffer.alloc(48, i);
      pubkeys.push(pubkey);
      validators.push(ssz.phase0.Validator.toViewDU({...validator, pubkey}));
    }
  });

  it("getPubkeysForIndices", () => {
    const pubkeysRes = getPubkeysForIndices(state.validators, indexes);
    expect(pubkeysRes.map(toHexString)).to.deep.equal(pubkeys.map(toHexString));
  });
});
