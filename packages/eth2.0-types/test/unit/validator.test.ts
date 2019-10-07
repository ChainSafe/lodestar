import {describe, it} from "mocha";
import {Validator} from "../../src/types/misc";
import {getRegistry, Registry} from "../../src/types/validator";
import BN from "bn.js";
import {expect} from "chai";
import { Gwei } from "../../src/types/primitive";

describe("ValidatorRegistry", () => {
  let validators: Partial<Validator>[] = [];
  let validatorRegistry: Registry<Partial<Validator>, Gwei>;
  const EFFECTIVE_BALANCES: BN[] = [];
  const TOTAL_ITEM = 6;

  before(() => {
    for (let i = 0; i < TOTAL_ITEM; i++) {
      EFFECTIVE_BALANCES.push(new BN(i));
    }
  });

  beforeEach(() => {
    validators = [];
    for (let i = 0; i < TOTAL_ITEM; i++) {
      validators.push({effectiveBalance: EFFECTIVE_BALANCES[i]});
    }
    validatorRegistry = getRegistry<Partial<Validator>, Gwei>(validators, (val: Partial<Validator>) => val.effectiveBalance);
  });

  it("should work well with index operator", () => {
    for (let i = 0; i < TOTAL_ITEM; i++) {
      expect(validatorRegistry[i].effectiveBalance.toNumber()).to.be.equal(i);
    }
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[3])).to.be.equal(3);
    const newItem: BN = new BN(2019);
    validatorRegistry[3] = {effectiveBalance: newItem};
    expect(validatorRegistry.findIndexByRegistry(newItem)).to.be.equal(3);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[3])).to.be.undefined;
  });

  it("should work well with forEach method", () => {
    validatorRegistry.forEach((value: Partial<Validator>, index: number) => {
      expect(value.effectiveBalance.toNumber()).to.be.equal(index);
    })
  });

  it("should return correct index from registry", () => {
    for (let i = 0; i < TOTAL_ITEM; i++) {
      expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[i])).to.be.equal(i);
    }
  });

  it("should work well after push", () => {
    const newItem: BN = new BN(2019);
    const count = validatorRegistry.length;
    validatorRegistry.push({effectiveBalance: newItem});
    expect(validatorRegistry.findIndexByRegistry(newItem)).to.be.equal(count);
  });

  it("should work well after splice", () => {
    const newItem: BN = new BN(2019);
    // delete 1, 2, 3 and insert 1 new
    validatorRegistry.splice(1, 3, {effectiveBalance: newItem});
    expect(validatorRegistry.findIndexByRegistry(newItem)).to.be.equal(1);
    // should not find deleted item anymore
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[1])).to.be.undefined;
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[2])).to.be.undefined;
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[3])).to.be.undefined;
    // old index is 4, new index is 3
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[4])).to.be.equal(2);
  });

  it("should work well after reverse method", () => {
    validatorRegistry.reverse();
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[0])).to.be.equal(5);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[1])).to.be.equal(4);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[2])).to.be.equal(3);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[3])).to.be.equal(2);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[4])).to.be.equal(1);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[5])).to.be.equal(0);
  });

  it("should work well after shift method", () => {
    validatorRegistry.shift();
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[0])).to.be.undefined;
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[1])).to.be.equal(0);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[2])).to.be.equal(1);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[3])).to.be.equal(2);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[4])).to.be.equal(3);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[5])).to.be.equal(4);
  });

  it("should work well after sort", () => {
    validatorRegistry.sort((val1, val2: Partial<Validator>) => val2.effectiveBalance.toNumber() - val1.effectiveBalance.toNumber());
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[0])).to.be.equal(5);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[1])).to.be.equal(4);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[2])).to.be.equal(3);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[3])).to.be.equal(2);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[4])).to.be.equal(1);
    expect(validatorRegistry.findIndexByRegistry(EFFECTIVE_BALANCES[5])).to.be.equal(0);
  });
});