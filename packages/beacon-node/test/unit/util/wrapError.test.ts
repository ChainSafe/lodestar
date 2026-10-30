import {describe, expect, it, vi} from "vitest";
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

  it.each([false, true])("maps callback failures with async=%s", async (async) => {
    const failure = {code: "TEST_ERROR"};
    const mapError = vi.fn(() => failure);
    const fn = () => {
      if (async) return Promise.reject(error);
      throw error;
    };

    expect(await wrapError(fn, mapError)).toEqual({err: failure});
    expect(mapError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it.each([false, true])("preserves callback success with async=%s", async (async) => {
    const mapError = vi.fn();
    const value = {slot: 1};
    const result = await wrapError(() => (async ? Promise.resolve(value) : value), mapError);

    expect(result).toEqual({err: null, result: value});
    expect(mapError).not.toHaveBeenCalled();
  });

  it("lets the mapper propagate an unexpected failure", async () => {
    await expect(
      wrapError(
        () => {
          throw error;
        },
        (caught) => {
          throw caught;
        }
      )
    ).rejects.toBe(error);
  });
});
