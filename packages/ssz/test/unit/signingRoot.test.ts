import {assert} from "chai";
import {describe, it} from "mocha";
import {SerializableObject, SerializableValue} from "@chainsafe/ssz-type-schema";

import {ArrayObject, OuterObject, SimpleObject,} from "./objects";

import {stringifyType} from "./utils";
import {signingRoot} from "../../src";

describe("signedRoot", () => {
  const testCases: {
    value: SerializableObject;
    type: any;
    expected: string;
  }[] = [
    {value: {b:0,a:0}, type: SimpleObject, expected: ""},
    {value: {b:2,a:1}, type: SimpleObject, expected: ""},
    {value: {v:3, subV:{v:6}}, type: OuterObject, expected: ""},
    {value: {v: [{b:2,a:1}, {b:4,a:3}]}, type: ArrayObject, expected: ""},
  ];
  for (const {type, value} of testCases) {
    it(`should correctly hash ${stringifyType(type)}`, () => {
      const actual = signingRoot(type, value).toString("hex");
      assert(actual);
    });
  }

  const failCases: {
    value: SerializableValue;
    type: any;
    reason: string;
  }[] = [
    {value: 1, type: "foo", reason: "Invalid type"},
    {value: 1, type: ["foo"], reason: "Invalid type"},
  ];
  for (const {type, value, reason} of failCases) {
    it(`should throw an error for ${stringifyType(type)}: ${reason}`, () => {
      assert.throws(() => signingRoot(type, value as SerializableObject));
    });
  }
});

