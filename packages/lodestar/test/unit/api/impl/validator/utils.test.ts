import {expect} from "chai";
import {toHexString, TreeBacked} from "@chainsafe/ssz";
import {allForks, BLSPubkey, ssz, ValidatorIndex} from "@chainsafe/lodestar-types";
import {getPubkeysForIndex, getPubkeysForIndices} from "../../../../../src/api/impl/validator/utils";

describe("api / impl / validator / utils", () => {
  const vc = 32;

  const pubkeys: BLSPubkey[] = [];
  const indexes: ValidatorIndex[] = [];
  let state: TreeBacked<allForks.BeaconState>;
  before("Prepare state", () => {
    state = ssz.phase0.BeaconState.defaultTreeBacked() as TreeBacked<allForks.BeaconState>;
    const validator = ssz.phase0.Validator.defaultValue();
    const validators = state.validators;
    for (let i = 0; i < vc; i++) {
      indexes.push(i);
      const pubkey = Buffer.alloc(48, i);
      pubkeys.push(pubkey);
      validators.push({...validator, pubkey});
    }
  });

  it("getPubkeysForIndices", () => {
    const pubkeysRes = getPubkeysForIndices(state.validators, indexes);
    expect(pubkeysRes.map(toHexString)).to.deep.equal(pubkeys.map(toHexString));
  });

  it("getPubkeysForIndex", () => {
    for (const index of indexes) {
      const pubkeyRes = getPubkeysForIndex(state.validators, index);
      expect(toHexString(pubkeyRes)).to.deep.equal(toHexString(pubkeys[index]), `Wrong pubkey for index ${index}`);
    }
  });
});
