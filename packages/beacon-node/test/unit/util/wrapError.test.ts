import {describe, it, expect} from "vitest";
import {wrapError} from "../../../src/util/wrapError.js";

describe("util / wrapError", () => {
  const error = Error("test-error");
  async function throwNoAwait(shouldThrow: boolean): Promise<boolean> {
    if (shouldThrow) throw error;

    return true;
  }

  async function throwAwait(shouldThrow: boolean): Promise<boolean> {
    await new Promise((r) => setTimeout(r, 0));
    if (shouldThrow) throw error;

    return true;
  }

  it("Handle error and result with throwNoAwait", async () => {
    const resErr = await wrapError(throwNoAwait(true));
    const resOk = await wrapError(throwNoAwait(false));

    expect(resErr).toEqual({err: error});
    expect(resOk).toEqual({err: null, result: true});
  });

  it("Handle error and result with throwAwait", async () => {
    const resErr = await wrapError(throwAwait(true));
    const resOk = await wrapError(throwAwait(false));

    expect(resErr).toEqual({err: error});
    expect(resOk).toEqual({err: null, result: true});
  });
});
