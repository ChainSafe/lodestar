import {expect} from "chai";
import {aggregateSignatures, aggregateSignaturesSync, Signature} from "../../import";
import {makeNapiTestSets} from "../utils";

describe("Aggregate Signatures", () => {
  const sets = makeNapiTestSets(10);
  const signatures = sets.map(({signature}) => signature);

  describe("aggregateSignaturesSync()", () => {
    it("should return a Signature", () => {
      const agg = aggregateSignaturesSync(signatures);
      expect(agg).to.be.instanceOf(Signature);
    });
    it("should be able to keyValidate Signature", () => {
      const agg = aggregateSignaturesSync(signatures);
      expect(agg!.sigValidateSync()).to.be.undefined;
    });
    it("should return a key that is not in the keys array", () => {
      const agg = aggregateSignaturesSync(signatures);
      const serialized = agg!.serialize();
      expect(signatures.find((key) => key.serialize() == serialized)).to.be.undefined;
    });
  });
  describe("aggregateSignatures()", () => {
    it("should return the promise of a Signature", async () => {
      const aggPromise = aggregateSignatures(signatures);
      expect(aggPromise).to.be.instanceOf(Promise);
      const agg = await aggPromise;
      expect(agg).to.be.instanceOf(Signature);
    });
    it("should be able to keyValidate Signature", async () => {
      const agg = await aggregateSignatures(signatures);
      const res = await agg!.sigValidate();
      expect(res).to.be.undefined;
    });
    it("should return a key that is not in the keys array", async () => {
      const agg = await aggregateSignatures(signatures);
      const serialized = agg!.serialize();
      expect(signatures.find((key) => key.serialize() == serialized)).to.be.undefined;
    });
  });
});
