import {describe, it} from "mocha";
import {CacheItem} from "../../../src/cache";
import {AnySSZType} from "@chainsafe/ssz-type-schema";
import BN from "bn.js";
import {hashTreeRoot} from "@chainsafe/ssz";
import {expect} from "chai";

const testType: AnySSZType = {
  fields: [
    ["test", "uint64"]
  ]
};

interface ITestType {
  test: BN;
}

class SimpleTestCache extends CacheItem<ITestType> {

  public constructor() {
    super(testType);
  }
}

describe("abstract cache", function () {
    
  describe("simple cache", function () {

    it("should get existing value", function () {
      const testValue: ITestType = {test: new BN(3)};
      const cache = new SimpleTestCache();
      cache.update(testValue);
      const value = cache.get(hashTreeRoot(testValue, testType));
      expect(value).to.be.deep.equal(testValue);
    });

    it("should be able to use custom id", function () {
      const testValue: ITestType = {test: new BN(3)};
      const cache = new SimpleTestCache();
      cache.update(testValue, "test");
      const value = cache.get("test");
      expect(value).to.be.deep.equal(testValue);
    });

    it("should not be affected by changing ref data", function () {
      const testValue: ITestType = {test: new BN(3)};
      const id = hashTreeRoot(testValue, testType);
      const cache = new SimpleTestCache();
      cache.update(testValue);
      testValue.test = new BN(5);
      const value = cache.get(id);
      expect(value.test).to.be.deep.equal(new BN(3));
      value.test = new BN(8);
      const value2 = cache.get(id);
      expect(value2.test).to.be.deep.equal(new BN(3));
    });

    it("should be able to delete cache item", function () {
      const testValue: ITestType = {test: new BN(3)};
      const id = hashTreeRoot(testValue, testType);
      const cache = new SimpleTestCache();
      cache.update(testValue);
      expect(cache.get(id)).to.not.be.null;
      cache.delete(id);
      expect(cache.get(id)).to.be.null;
    });

    it("should be able to clear cache", function () {
      const testValue: ITestType = {test: new BN(3)};
      const id = hashTreeRoot(testValue, testType);
      const cache = new SimpleTestCache();
      cache.update(testValue);
      expect(cache.get(id)).to.not.be.null;
      cache.clear();
      expect(cache.get(id)).to.be.null;
    });

  });
    
});