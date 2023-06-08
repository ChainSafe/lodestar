import {expect} from "chai";
import {
  aggregateVerify,
  aggregateVerifySync,
  fastAggregateVerify,
  fastAggregateVerifySync,
  verify,
  verifySync,
} from "../../import";
import {sullyUint8Array, makeNapiTestSets} from "../utils";
import {NapiTestSet} from "../types";

describe("Verify", () => {
  let testSet: NapiTestSet;
  before(() => {
    testSet = makeNapiTestSets(1)[0];
  });
  describe("verifySync", () => {
    it("should return a boolean", () => {
      expect(verifySync(testSet.msg, testSet.publicKey, testSet.signature)).to.be.a("boolean");
    });
    it("should default to false", () => {
      expect(verifySync(sullyUint8Array(testSet.msg), testSet.publicKey, testSet.signature)).to.be.false;
      expect(verifySync(testSet.msg, sullyUint8Array(testSet.publicKey.serialize()), testSet.signature)).to.be.false;
      expect(verifySync(testSet.msg, testSet.publicKey, sullyUint8Array(testSet.signature.serialize()))).to.be.false;
    });
    it("should return true for valid sets", () => {
      expect(verifySync(testSet.msg, testSet.publicKey, testSet.signature)).to.be.true;
    });
  });
  describe("verify", () => {
    it("should return Promise<boolean>", async () => {
      const resPromise = verify(testSet.msg, testSet.publicKey, testSet.signature);
      expect(resPromise).to.be.instanceOf(Promise);
      const res = await resPromise;
      expect(res).to.be.a("boolean");
    });
    it("should default to Promise<false>", async () => {
      expect(await verify(sullyUint8Array(testSet.msg), testSet.publicKey, testSet.signature)).to.be.false;
      expect(await verify(testSet.msg, sullyUint8Array(testSet.publicKey.serialize()), testSet.signature)).to.be.false;
      expect(await verify(testSet.msg, testSet.publicKey, sullyUint8Array(testSet.signature.serialize()))).to.be.false;
    });
    it("should return true for valid sets", async () => {
      expect(await verify(testSet.msg, testSet.publicKey, testSet.signature)).to.be.true;
    });
  });
});

describe("Aggregate Verify", () => {
  let testSet: NapiTestSet;
  before(() => {
    testSet = makeNapiTestSets(1)[0];
  });
  describe("aggregateVerifySync", () => {
    it("should return a boolean", () => {
      expect(aggregateVerifySync([testSet.msg], [testSet.publicKey], testSet.signature)).to.be.a("boolean");
    });
    it("should default to false", () => {
      expect(aggregateVerifySync([sullyUint8Array(testSet.msg)], [testSet.publicKey], testSet.signature)).to.be.false;
      expect(aggregateVerifySync([testSet.msg], [sullyUint8Array(testSet.publicKey.serialize())], testSet.signature)).to
        .be.false;
      expect(aggregateVerifySync([testSet.msg], [testSet.publicKey], sullyUint8Array(testSet.signature.serialize()))).to
        .be.false;
    });
    it("should return true for valid sets", () => {
      expect(aggregateVerifySync([testSet.msg], [testSet.publicKey], testSet.signature)).to.be.true;
    });
  });
  describe("aggregateVerify", () => {
    it("should return Promise<boolean>", async () => {
      const resPromise = aggregateVerify([testSet.msg], [testSet.publicKey], testSet.signature);
      expect(resPromise).to.be.instanceOf(Promise);
      const res = await resPromise;
      expect(res).to.be.a("boolean");
    });
    it("should default to Promise<false>", async () => {
      expect(await aggregateVerify([sullyUint8Array(testSet.msg)], [testSet.publicKey], testSet.signature)).to.be.false;
      expect(await aggregateVerify([testSet.msg], [sullyUint8Array(testSet.publicKey.serialize())], testSet.signature))
        .to.be.false;
      expect(await aggregateVerify([testSet.msg], [testSet.publicKey], sullyUint8Array(testSet.signature.serialize())))
        .to.be.false;
    });
    it("should return true for valid sets", async () => {
      expect(await aggregateVerify([testSet.msg], [testSet.publicKey], testSet.signature)).to.be.true;
    });
  });
});

describe("Fast Aggregate Verify", () => {
  let testSet: NapiTestSet;
  before(() => {
    testSet = makeNapiTestSets(1)[0];
  });
  describe("fastAggregateVerifySync", () => {
    it("should return a boolean", () => {
      expect(fastAggregateVerifySync(testSet.msg, [testSet.publicKey], testSet.signature)).to.be.a("boolean");
    });
    it("should default to false", () => {
      expect(fastAggregateVerifySync(sullyUint8Array(testSet.msg), [testSet.publicKey], testSet.signature)).to.be.false;
      expect(fastAggregateVerifySync(testSet.msg, [sullyUint8Array(testSet.publicKey.serialize())], testSet.signature))
        .to.be.false;
      expect(fastAggregateVerifySync(testSet.msg, [testSet.publicKey], sullyUint8Array(testSet.signature.serialize())))
        .to.be.false;
    });
    it("should return true for valid sets", () => {
      expect(fastAggregateVerifySync(testSet.msg, [testSet.publicKey], testSet.signature)).to.be.true;
    });
  });
  describe("fastAggregateVerify", () => {
    it("should return Promise<boolean>", async () => {
      const resPromise = fastAggregateVerify(testSet.msg, [testSet.publicKey], testSet.signature);
      expect(resPromise).to.be.instanceOf(Promise);
      const res = await resPromise;
      expect(res).to.be.a("boolean");
    });
    it("should default to Promise<false>", async () => {
      expect(await fastAggregateVerify(sullyUint8Array(testSet.msg), [testSet.publicKey], testSet.signature)).to.be
        .false;
      expect(
        await fastAggregateVerify(testSet.msg, [sullyUint8Array(testSet.publicKey.serialize())], testSet.signature)
      ).to.be.false;
      expect(
        await fastAggregateVerify(testSet.msg, [testSet.publicKey], sullyUint8Array(testSet.signature.serialize()))
      ).to.be.false;
    });
    it("should return true for valid sets", async () => {
      expect(await fastAggregateVerify(testSet.msg, [testSet.publicKey], testSet.signature)).to.be.true;
    });
  });
});
