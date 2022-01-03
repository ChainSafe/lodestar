import {ssz} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {PubkeyIndexMap} from "../../../src/allForks/util/pubkey2index";

describe("Pubkey2Index", () => {
  it("Should set multiple keys with collisions", () => {
    const pubkey2index = new PubkeyIndexMap();

    const pkStrs = [
      "a62420543ceef8d77e065c70da15f7b731e56db5457571c465f025e032bbcd263a0990c8749b4ca6ff20d77004454b51",
      "b2ce0f79f90e7b3a113ca5783c65756f96c4b4673c2b5c1eb4efc2228025944106d601211e8866dc5b50dc48a244dd7c",
      // Same as previous up to half bytes
      "b2ce0f79f90e7b3a113ca5783c65756f96c4b4673c2b5c10000000000000000000000000000000000000000000000000",
      // Only last byte is different
      "b2ce0f79f90e7b3a113ca5783c65756f96c4b4673c2b5c1eb4efc2228025944106d601211e8866dc5b50dc48a244dd00",
    ];
    const pks = pkStrs.map((pkStr) => new Uint8Array(Buffer.from(pkStr, "hex")));

    // Prepare state with pubkeys
    const state = ssz.phase0.BeaconState.defaultValue();
    for (let i = 0; i < pkStrs.length; i++) {
      const validator = ssz.phase0.Validator.defaultValue();
      validator.pubkey = pks[i];
      state.validators[i] = validator;
    }

    // Set all validators
    for (let i = 0; i < pkStrs.length; i++) {
      expect(pubkey2index.get(pkStrs[i])).to.equal(undefined, `pkStr ${i} should not be known before set`);
      expect(pubkey2index.get(pks[i])).to.equal(undefined, `pk ${i} should not be known before set`);

      pubkey2index.set(pks[i], i, state);

      expect(pubkey2index.get(pkStrs[i])).to.equal(i, `pkStr ${i} should be known after set`);
      expect(pubkey2index.get(pks[i])).to.equal(i, `pk ${i} should be known after set`);
      expect(pubkey2index.size).to.equal(i + 1, "Wrong pubkey2index.size");
    }

    // Get all keys again
    for (let i = 0; i < pkStrs.length; i++) {
      expect(pubkey2index.get(pkStrs[i])).to.equal(i, `pkStr ${i} should be known again after set`);
      expect(pubkey2index.get(pks[i])).to.equal(i, `pk ${i} should be known again after set`);
    }

    // Try to set keys and expect to fail
    for (let i = 0; i < pkStrs.length; i++) {
      expect(() => pubkey2index.set(pks[i], i, state)).to.throw("Attempting to set existing PubkeyIndexMap entry");
    }
  });
});
