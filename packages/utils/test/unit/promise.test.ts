import "../setup.js";
import {expect} from "chai";
import sinon from "sinon";
import {callFnWhenAwait} from "../../src/promise.js";

describe("callFnWhenAwait util", function () {
  const sandbox = sinon.createSandbox();
  beforeEach(() => {
    sandbox.useFakeTimers();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should call function while awaing for promise", async () => {
    const p = new Promise<string>((resolve) => setTimeout(() => resolve("done"), 5 * 1000));
    const stub = sandbox.stub();
    const result = await Promise.all([callFnWhenAwait(p, stub, 2 * 1000), sandbox.clock.tickAsync(5000)]);
    expect(result[0]).to.be.equal("done");
    expect(stub).to.be.calledTwice;
    await sandbox.clock.tickAsync(5000);
    expect(stub).to.be.calledTwice;
  });

  it("should throw error", async () => {
    const stub = sandbox.stub();
    const p = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("done")), 5 * 1000));
    try {
      await Promise.all([callFnWhenAwait(p, stub, 2 * 1000), sandbox.clock.tickAsync(5000)]);
      expect.fail("should throw error here");
    } catch (e) {
      expect((e as Error).message).to.be.equal("done");
      expect(stub).to.be.calledTwice;
    }
  });
});
