/* eslint-disable @typescript-eslint/camelcase */
import {AnyContainerType, Type} from "@chainsafe/ssz-type-schema";
import {fromJson} from "../../src/converters";
import {expect} from "chai";

interface ITestType {
  numberProp: number;
  bigintProp: bigint;
}

const sszType: AnyContainerType = {
  type: Type.container,
  fields: [
    ["numberProp", "uint32"],
    ["bigintProp", "uint64"],
  ]
};

describe("json converter", function () {

  it("should expand to proper type", function () {
    const json = {
      number_prop: 167,
      bigint_prop: "100000000000000000000000000000000000000000"
    };
    const result = fromJson<ITestType>(json, sszType);
    expect(result).to.not.be.null;
    expect(result.numberProp).to.be.equal(json.number_prop);
    expect(result.bigintProp === BigInt("100000000000000000000000000000000000000000")).to.be.true;
  });

  it("should expand infinity", function () {
    const json = {
      number_prop: "100000000000000000000000000000000000000000",
      bigint_prop: BigInt("100000000000000000000000000000000000000000")
    };
    const result = fromJson<ITestType>(json, sszType);
    expect(result).to.not.be.null;
    expect(result.numberProp).to.be.equal(Infinity);
  });
    
});
