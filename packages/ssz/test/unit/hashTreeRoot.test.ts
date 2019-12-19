import {assert} from "chai";
import {describe, it} from "mocha";
import {hashTreeRoot,} from "../../src";
import {AnySSZType, SerializableValue, Type,} from "@chainsafe/ssz-type-schema";


import {ArrayObject, OuterObject, SimpleObject,} from "./objects";

import {stringifyType} from "./utils";

describe("hashTreeRoot", () => {
  const testCases: {
    value: SerializableValue;
    type: any;
    expected: string;
  }[] = [
    {value: true, type: "bool", expected: ""},
    {value: false, type: "bool", expected: ""},
    {value: 0, type: "number8", expected: ""},
    {value: 1, type: "number8", expected: ""},
    {value: 255, type: "number8", expected: ""},
    {value: 2**8, type: "number16", expected: ""},
    {value: 2**12-1, type: "number16", expected: ""},
    {value: 2**12, type: "number16", expected: ""},
    {value: 2**16-1, type: "number16", expected: ""},
    {value: 2**16, type: "number32", expected: ""},
    {value: 2**28-1, type: "number32", expected: ""},
    {value: 2**28, type: "number32", expected: ""},
    {value: 2**32-1, type: "number32", expected: ""},
    {value: 2**32, type: "number64", expected: ""},
    {value: 2**52-1, type: "number64", expected: ""},
    {value: 2**32, type: "number64", expected: hashTreeRoot("number64", 2**32).toString("hex")},
    {value: 2**52-1, type: "number64", expected: hashTreeRoot("number64", 2**52-1).toString("hex")},
    {value: 0x1n , type: "bigint64", expected: ""},
    {value: 0x1000000000000000n, type: "bigint64", expected: ""},
    {value: 0xffffffffffffffffn, type: "bigint64", expected: ""},
    {value: 0xffffffffffffffffffffffffffffffffn, type: "bigint128", expected: ""},
    {
      value: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn
      , type: "bigint256", expected: ""
    },
    {value: Buffer.from("deadbeef", "hex"), type: "bytes4", expected: ""},
    {value: Buffer.from("deadbeef", "hex"), type: {elementType: "byte", maxLength: 100}, expected: ""},
    {value: Buffer.from("deadbeef", "hex"), type: {elementType: "byte", length: 4}, expected: ""},
    {
      value: Buffer.from("deadbeefdeadbeefdeadbeefdeadbeef", "hex"),
      type: {elementType: "byte", length: 16}, expected: ""
    },
    {value: Buffer.from("deadbeef", "hex"), type: {elementType: "byte", maxLength: 100}, expected: ""},
    {value: {b:0,a:0}, type: SimpleObject, expected: ""},
    {value: {b:2,a:1}, type: SimpleObject, expected: ""},
    {value: {v:3, subV:{v:6}}, type: OuterObject, expected: ""},
    {value: {v: [{b:2,a:1}, {b:4,a:3}]}, type: ArrayObject, expected: ""},
    {value: [{v:3, subV:{v:6}}, {v:5, subV:{v:7}}], type: {elementType: OuterObject, maxLength: 100}, expected: ""},
    {value: [], type: {elementType: "number16", maxLength: 100}, expected: ""},
    {value: [], type: {elementType: OuterObject, maxLength: 100}, expected: ""},
  ];
  for (const {type, value} of testCases) {
    it(`should correctly hash ${stringifyType(type)}`, () => {
      const actual = hashTreeRoot(type, value).toString("hex");
      assert(actual);
    });
  }

  it("should hash active validation indexes correctly as in final_updates_minimal.yalm", () => {
    const validatorIndexes = [];
    for (let i = 0; i < 64; i++) {
      validatorIndexes.push(i);
    }
    const type: AnySSZType = {
      // @ts-ignore
      elementType: {type:0, byteLength:8, useNumber:true},
      // VALIDATOR_REGISTRY_LIMIT
      maxLength: 1099511627776
    };
    // This is the logic to calculate activeIndexRoots in processFinalUpdates
    const hash = hashTreeRoot(type, validatorIndexes).toString("hex");
    const want = "ba1031ba1a5daab0d49597cfa8664ce2b4c9b4db6ca69fbef51e0a9a325a3b63";
    assert.strictEqual(hash, want, "hash does not match");
  });

  it("should be able to hash inner object as list of basic object", () => {
    const accountBalances: {balances: bigint[]} = {
      balances: []
    };
    const count = 2;
    for (let i = 0; i < count; i++) {
      accountBalances.balances.push(0x32000000000n);
    }
    const accountBalancesType: AnySSZType = {
      fields: [["balances", {elementType: "bigint64", maxLength: count}]]
    };
    const hash = hashTreeRoot(accountBalancesType, accountBalances).toString("hex");
    assert(hash);
  });

  it("should have the same result to Prysmatic ssz unit test", () => {
    const previousVersionBuf = Buffer.from("9f41bd5b", "hex");
    const previousVersion = Uint8Array.from(previousVersionBuf);
    const curVersionBuf = Buffer.from("cbb0f1d7", "hex");
    const curVersion = Uint8Array.from(curVersionBuf);
    const fork = {
      previousVersion,
      curVersion,
      epoch: 11971467576204192310n
    };
    const forkType: AnySSZType = {
      fields: [
        ["previousVersion", {elementType: "byte", length: 4}],
        ["curVersion", {elementType: "byte", length: 4}],
        ["epoch", "bigint64"]
      ]
    };
    const finalHash = hashTreeRoot(forkType, fork).toString("hex");
    const want = "3ad1264c33bc66b43a49b1258b88f34b8dbfa1649f17e6df550f589650d34992";
    assert.strictEqual(finalHash, want, "finalHash does not match");
  });

  const failCases: {
    value: SerializableValue;
    type: any;
    reason: string;
  }[] = [
    {value: 1, type: "foo", reason: "Invalid type"},
    {value: 1, type: "bar", reason: "Invalid type"},
    {
      value: Buffer.from("deadbeefdeadbeefdeadbeefdeadbeef", "hex"),
      type: "bytes32", reason: "Invalida byte array length"
    },
  ];
  for (const {type, value, reason} of failCases) {
    it(`should throw an error for ${stringifyType(type)}: ${reason}`, () => {
      assert.throws(() => hashTreeRoot(type, value));
    });
  }
});

