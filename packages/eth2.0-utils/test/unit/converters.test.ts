/* eslint-disable @typescript-eslint/camelcase */
import BN from "bn.js";
import {AnyContainerType, Type} from "@chainsafe/ssz-type-schema";
import {fromJson} from "../../src/converters";
import {expect} from "chai";

interface ITestType {
  numberProp: number;
  bnProp: BN;
}

const sszType: AnyContainerType = {
  type: Type.container,
  fields: [
    ["numberProp", "uint32"],
    ["bnProp", "uint64"],
  ]
};

describe("json converter", function () {

  it("should expand to proper type", function () {
    const json = {
      number_prop: 167,
      bn_prop: new BN("100000000000000000000000000000000000000000").toString(10)
    };
    const result = fromJson<ITestType>(json, sszType);
    expect(result).to.not.be.null;
    expect(result.numberProp).to.be.equal(json.number_prop);
    expect(result.bnProp.eq(new BN("100000000000000000000000000000000000000000"))).to.be.true;
  });

  it("should expand infinity", function () {
    const json = {
      number_prop: new BN("100000000000000000000000000000000000000000").toString(),
      bn_prop: new BN("100000000000000000000000000000000000000000")
    };
    const result = fromJson<ITestType>(json, sszType);
    expect(result).to.not.be.null;
    expect(result.numberProp).to.be.equal(Infinity);
  });
    
});