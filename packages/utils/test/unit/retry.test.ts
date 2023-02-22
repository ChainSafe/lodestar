import "../setup.js";
import {expect} from "chai";
import {retry, RetryOptions} from "../../src/retry.js";

describe("retry", () => {
  type TestCase = {
    id: string;
    fn: (attempt: number) => Promise<any>;
    opts?: RetryOptions;
    result: any | Error;
  };

  const sampleError = Error("SAMPLE ERROR");
  const sampleResult = "SAMPLE RESULT";
  const retries = 3;

  const testCases: TestCase[] = [
    {
      id: "Reject",
      fn: () => Promise.reject(sampleError),
      result: sampleError,
    },
    {
      id: "Resolve",
      fn: () => Promise.resolve(sampleResult),
      result: sampleResult,
    },
    {
      id: "Succeed at the last attempt",
      fn: async (attempt) => {
        if (attempt < retries) throw sampleError;
        else return sampleResult;
      },
      opts: {retries},
      result: sampleResult,
    },
  ];

  for (const {id, fn, opts, result} of testCases) {
    it(id, async () => {
      if (result instanceof Error) {
        await expect(retry(fn, opts)).to.be.rejectedWith(result);
      } else {
        expect(await retry(fn, opts)).to.deep.equal(result);
      }
    });
  }
});
