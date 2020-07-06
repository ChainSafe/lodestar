import {describe, it} from "mocha";
import {expect} from "chai";
import {retryable} from "../../../src/util/function";
import sinon from "sinon";


describe("retryable", () => {
  it("should retry multiple times with function - return null", async function() {
    const spy = sinon.spy();
    const func = (i: number): Promise<string | null> => {
      spy();
      return (i === 3)? Promise.resolve("good") : Promise.resolve(null);
    };
    // always bind 0, it will return null
    func.bind(null, 0);
    const result = await retryable<string>(func, 10);
    expect(result).to.be.equal(null);
    expect(spy.callCount).to.be.equal(10);
  });

  it("should retry multiple times with function - return onBigInt(2)d call", async function() {
    const stub = sinon.stub();
    stub.onSecondCall().returns(3);
    const func = (): Promise<string | null> => {
      return (stub() === 3)? Promise.resolve("good") : Promise.resolve(null);
    };
    const result = await retryable<string>(func, 10);
    expect(result).to.be.equal("good");
    expect(stub.callCount).to.be.equal(2);
  });

  it("should retry multiple times with generator", async function() {
    const func = (i: number): Promise<string | null> => {
      return (i === 3)? Promise.resolve("good") : Promise.resolve(null);
    };
    type testFunc = (i: number) => Promise<string | null>;
    function* indexGen(): Generator<testFunc> {
      let i = 0;
      while(true) {
        yield func.bind(null, i++);
      }
    }
    const result = await retryable<string>(indexGen(), 10);
    expect(result).to.be.equal("good");
  });
});
