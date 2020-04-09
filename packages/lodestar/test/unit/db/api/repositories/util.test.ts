import { generateEmptySignedBlock } from "../../../../utils/block";
import {expect} from "chai";
import { isEligibleBlock } from "../../../../../src/db/api/beacon/repositories/util";

describe("isEligibleBlock", () => {
  it("should return true if no step", () => {
    const signedBlock = generateEmptySignedBlock();
    const step = 0;
    const safeLowerLimit = 0;
    expect(isEligibleBlock(signedBlock, step, safeLowerLimit)).to.be.equal(true);
  });
  
  it("should return true if safeLowerLimit is not a number", () => {
    const signedBlock = generateEmptySignedBlock();
    const step = 20;
    const safeLowerLimit = Buffer.alloc(0);
    expect(isEligibleBlock(signedBlock, step, safeLowerLimit)).to.be.equal(true);
  });

  it("should return true if correct block slot", () => {
    const signedBlock = generateEmptySignedBlock();
    signedBlock.message.slot = 20;
    const step = 20;
    const safeLowerLimit = 0;
    expect(isEligibleBlock(signedBlock, step, safeLowerLimit)).to.be.equal(true);
  });

  it("should return false if incorrect block slot", () => {
    const signedBlock = generateEmptySignedBlock();
    signedBlock.message.slot = 10;
    const step = 20;
    const safeLowerLimit = 0;
    expect(isEligibleBlock(signedBlock, step, safeLowerLimit)).to.be.equal(false);
  });
});