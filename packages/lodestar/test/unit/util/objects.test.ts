import {expect} from "chai";
import {Uint64} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {arrayIntersection, mostFrequent, sszEqualPredicate} from "../../../src/util/objects";
import {describe, it} from "mocha";

describe("Objects helper", () => {

  it("return most frequent objects", () => {
    const obj1 = 1n;
    const obj2 = 2n;
    const obj3 = 3n;
    const array = [];
    array.push(obj1);
    array.push(obj1);
    array.push(obj3);
    array.push(obj2);
    array.push(obj3);
    array.push(obj1);
    array.push(obj3);
    const result = mostFrequent<Uint64>(config.types.Uint64, array);
    expect(result).to.be.deep.equal([obj1, obj3]);
  });
  
  it("should return array intersection", function () {
    const array1 = [2, 5, 7, 8];
    const array2 = [1, 5, 7, 9];
    const result = arrayIntersection<number>(array1, array2, sszEqualPredicate(config.types.Number64));
    expect(result).to.be.deep.equal([5, 7]);

  });

});
