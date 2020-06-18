import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {expect, assert} from "chai";

import {generateState} from "../../../utils/state";
import {generateValidator} from "../../../utils/validator";
import {EpochContext} from "../../../../src/fast/util/epochContext";

describe("EpochContext", () => {
  describe("pubkey2index map", () => {
    it("should share same pubkey map after copy", () => {
      const validator0 = generateValidator();
      validator0.pubkey = Buffer.alloc(48, 1);
      const state0 = generateState({validators: [validator0]});
      const epochCtx = new EpochContext(config);
      epochCtx.syncPubkeys(state0);
      const copiedEpochCtx = epochCtx.copy();
      expect(epochCtx.pubkey2index.get(validator0.pubkey)).to.be.equal(0);
      expect(copiedEpochCtx.pubkey2index.get(validator0.pubkey)).to.be.equal(0);
      const validator1 = generateValidator();
      validator1.pubkey = Buffer.alloc(48, 2);
      const state1 = generateState({validators: [validator0, validator1]});
      epochCtx.syncPubkeys(state1);
      expect(epochCtx.pubkey2index.get(validator1.pubkey)).to.be.equal(1);
      // this works even we didn't call copy() again
      expect(copiedEpochCtx.pubkey2index.get(validator1.pubkey)).to.be.equal(1);
    });

    it("should not be able to mutate pubkey map from outside", () => {
      try {
        const epochCtx = new EpochContext(config);
        epochCtx.syncPubkeys(generateState());
        // @ts-ignore
        epochCtx.pubkey2index.set(Buffer.alloc(48), 0);
        assert.fail("Expect error here");
      } catch (e) {
        expect(e.message).to.be.equal("Illegal access 'set' from pubkey2index");
      }
    });
  });
});