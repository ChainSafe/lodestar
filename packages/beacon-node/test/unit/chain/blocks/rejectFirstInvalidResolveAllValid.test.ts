import {expect} from "chai";
import {rejectFirstInvalidResolveAllValid} from "../../../../src/chain/blocks/verifyBlocksSignatures.js";

/* eslint-disable @typescript-eslint/explicit-function-return-type */

describe("chain / blocks / rejectFirstInvalidResolveAllValid", () => {
  it("Reject on first isValid = false", async () => {
    const {resolves, log, logStrs} = prepareTest();
    await tick();

    log("2_true");
    resolves[2](true);
    await tick();

    // Should resolve rejectFirstInvalidResolveAllValid()
    log("1_false");
    resolves[1](false);
    await tick();

    // Already done
    log("0_false");
    resolves[0](false);
    await tick();

    expect(logStrs).deep.equals(["2_true", "1_false", "invalid_1", "0_false"]);
  });

  it("Resolve when all isValid = true", async () => {
    const {resolves, log, logStrs} = prepareTest();
    await tick();

    for (const [i, resolve] of resolves.entries()) {
      log(`${i}_true`);
      resolve(true);
      await tick();
    }

    expect(logStrs).deep.equals(["0_true", "1_true", "2_true", "all_valid"]);
  });
});

function tick() {
  return new Promise((r) => process.nextTick(r));
}

function prepareTest() {
  const promises: Promise<boolean>[] = [];
  const resolves: ((value: boolean) => void)[] = [];
  for (let i = 0; i < 3; i++) {
    const {promise, resolve} = resolvablePromise<boolean>();
    promises.push(promise);
    resolves.push(resolve);
  }

  const logStrs: string[] = [];

  function log(str: string) {
    logStrs.push(str);
  }

  rejectFirstInvalidResolveAllValid(promises)
    .then((res) => {
      if (res.allValid) log("all_valid");
      else log(`invalid_${res.index}`);
    })
    .catch(() => log("all_error"));

  return {resolves, log, logStrs};
}

function resolvablePromise<T>() {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>((_resolve) => {
    resolve = _resolve;
  });
  if (resolve === null) throw Error("resolve is null");
  return {promise, resolve};
}
