import BN from "bn.js";
import {expect} from "chai";

import {uint64} from "@chainsafe/eth2-types";
import {isPlainObject, mostFrequent} from "../../../src/util/objects";
import {createIBeaconConfig} from "../../../src/config";
import * as mainnetParams from "../../../src/params/presets/mainnet";


describe('Objects helper', () => {

  let config = createIBeaconConfig(mainnetParams);

  it('should be plain object', () => {
    expect(isPlainObject(Object.create({}))).to.be.true;
    expect(isPlainObject(Object.create(Object.create(Object.prototype)))).to.be.true;
    expect(isPlainObject({ foo: 'bar' })).to.be.true;
    expect(isPlainObject({})).to.be.true;
  });

  it('should not be plain object', () => {
    expect(isPlainObject(1)).to.be.false;
    expect(isPlainObject(['foo', 'bar'])).to.be.false;
    expect(isPlainObject([])).to.be.false;
    expect(isPlainObject(null)).to.be.false;
  });

  it('return most frequent objects', () => {
    const obj1 = new BN(1);
    const obj2 = new BN(2);
    const obj3 = new BN(3);
    const array = [];
    array.push(obj1);
    array.push(obj1);
    array.push(obj3);
    array.push(obj2);
    array.push(obj3);
    array.push(obj1);
    array.push(obj3);
    const result = mostFrequent<uint64>(array, config.types.uint64);
    expect(result).to.be.deep.equal([obj1, obj3]);
  });

});
