import {init, getContext, destroy} from "../../src/context";
import {expect} from "chai";

describe("bls wasm constext", function () {

  afterEach(() => {
    destroy();
  });

  it("initializes and works", async function () {
    await init();
    expect(getContext().getCurveOrder())
      .to.be.equal("52435875175126190479447740508185965837690552500527637822603658699938581184513");
  });

  it("throws if context not initialized", async function () {
    expect(() => getContext().getCurveOrder()).to.throw();
  });

});