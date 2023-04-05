import {expect} from "chai";
import {nullableResult, wrapError} from "../../../src/util/wrapError.js";

describe("util / wrapError", () => {
  const error = Error("test-error");
  async function throwNoAwait(shouldThrow: boolean): Promise<boolean> {
    if (shouldThrow) throw error;
    else return true;
  }

  async function throwAwait(shouldThrow: boolean): Promise<boolean> {
    await new Promise((r) => setTimeout(r, 0));
    if (shouldThrow) throw error;
    else return true;
  }

  it("Handle error and result with throwNoAwait", async () => {
    const resErr = await wrapError(throwNoAwait(true));
    const resOk = await wrapError(throwNoAwait(false));

    expect(resErr).to.deep.equal({err: error}, "Wrong resErr");
    expect(resOk).to.deep.equal({err: null, result: true}, "Wrong resOk");
  });

  it("Handle error and result with throwAwait", async () => {
    const resErr = await wrapError(throwAwait(true));
    const resOk = await wrapError(throwAwait(false));

    expect(resErr).to.deep.equal({err: error}, "Wrong resErr");
    expect(resOk).to.deep.equal({err: null, result: true}, "Wrong resOk");
  });
});

describe("util/nullableResult", () => {
  function throwNoAwait(shouldThrow: boolean): boolean {
    if (shouldThrow) throw Error("test-error");
    else return true;
  }

  it("Handle error and result with throwNoAwait", () => {
    const resErr = nullableResult(throwNoAwait)(true);
    const resOk = nullableResult(throwNoAwait)(false);

    expect(resErr).to.equal(null, "Wrong resErr");
    expect(resOk).to.equal(true, "Wrong resOk");
  });
});
