import {isPlainObject} from "../../../src/helpers/objects";
import {expect} from "chai";
import {BeaconNodeCommand} from "../../../src/cli/commands/index";

describe('Objects helper', () => {

  it('should be plain object', () => {
    expect(isPlainObject(Object.create({}))).to.be.true;
    expect(isPlainObject(Object.create(Object.create(Object.prototype)))).to.be.true;
    expect(isPlainObject({foo: 'bar'})).to.be.true;
    expect(isPlainObject({})).to.be.true;
  });

  it('should not be plain object', () => {
    expect(isPlainObject(1)).to.be.false;
    expect(isPlainObject(['foo', 'bar'])).to.be.false;
    expect(isPlainObject([])).to.be.false;
    expect(isPlainObject(null)).to.be.false;
  })

});
