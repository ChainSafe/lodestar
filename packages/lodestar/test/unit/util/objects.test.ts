import {expect} from "chai";
import {ssz, Uint64} from "@chainsafe/lodestar-types";
import {arrayIntersection, mostFrequent, sszEqualPredicate} from "../../../src/util/objects";

describe("Objects helper", () => {
  it("return most frequent objects", () => {
    const obj1 = BigInt(1);
    const obj2 = BigInt(2);
    const obj3 = BigInt(3);
    const array: bigint[] = [];
    array.push(obj1);
    array.push(obj1);
    array.push(obj3);
    array.push(obj2);
    array.push(obj3);
    array.push(obj1);
    array.push(obj3);
    const result = mostFrequent<Uint64>(ssz.Uint64, array);
    expect(result).to.be.deep.equal([obj1, obj3]);
  });

  it("should return array intersection", function () {
    const array1 = [2, 5, 7, 8];
    const array2 = [1, 5, 7, 9];
    const result = arrayIntersection<number>(array1, array2, sszEqualPredicate(ssz.Number64));
    expect(result).to.be.deep.equal([5, 7]);
  });
});
