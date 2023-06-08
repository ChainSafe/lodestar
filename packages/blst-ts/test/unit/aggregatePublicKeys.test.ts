import {expect} from "chai";
import {aggregatePublicKeys, aggregatePublicKeysSync, PublicKey} from "../../import";
import {makeNapiTestSets} from "../utils";

describe("Aggregate Public Keys", () => {
  const sets = makeNapiTestSets(10);
  const keys = sets.map(({publicKey}) => publicKey);

  describe("aggregatePublicKeysSync()", () => {
    it("should return the promise of a PublicKey", () => {
      const agg = aggregatePublicKeysSync(keys);
      expect(agg).to.be.instanceOf(PublicKey);
    });
    it("should be able to keyValidate PublicKey", () => {
      const agg = aggregatePublicKeysSync(keys);
      expect(agg!.keyValidateSync()).to.be.undefined;
    });
    it("should return a key that is not in the keys array", () => {
      const agg = aggregatePublicKeysSync(keys);
      const serialized = agg!.serialize();
      expect(keys.find((key) => key.serialize() == serialized)).to.be.undefined;
    });
  });
  describe("aggregatePublicKeys()", () => {
    it("should return the promise of a PublicKey", async () => {
      const aggPromise = aggregatePublicKeys(keys);
      expect(aggPromise).to.be.instanceOf(Promise);
      const agg = await aggPromise;
      expect(agg).to.be.instanceOf(PublicKey);
    });
    it("should be able to keyValidate PublicKey", async () => {
      const agg = await aggregatePublicKeys(keys);
      const res = await agg!.keyValidate();
      expect(res).to.be.undefined;
    });
    it("should return a key that is not in the keys array", async () => {
      const agg = await aggregatePublicKeys(keys);
      const serialized = agg!.serialize();
      expect(keys.find((key) => key.serialize() == serialized)).to.be.undefined;
    });
  });
});
