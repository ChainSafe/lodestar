import {expect} from "chai";
import {printStackTraceLast, extractStackTraceFromJson} from "../../../src/logger/format";
import {toJson} from "../../../src/json";
import {LodestarError} from "../../../src/errors";

describe("logger / format / printStackTraceLast", () => {
  it("Should print nested error stack traces together", () => {
    type TestNestedErrorType = {
      code: "TEST_NESTED_ERROR";
      nestedError: Error;
    };

    class TestNestedError extends LodestarError<TestNestedErrorType> {}

    const nestedError = new Error("TEST_ERROR");
    const testNestedError = new TestNestedError({code: "TEST_NESTED_ERROR", nestedError});

    const expectedStacks = [nestedError.stack, testNestedError.stack];

    const nestedErrorAsJson = toJson(testNestedError);
    const stacks = extractStackTraceFromJson(nestedErrorAsJson);

    expect(stacks).to.deep.equal(expectedStacks, "Wrong extracted stacks");

    const logString = printStackTraceLast(testNestedError);
    expect(logString).to.equal(
      // eslint-disable-next-line quotes
      ['code=TEST_NESTED_ERROR, nestedError={"message":"TEST_ERROR"}', ...expectedStacks].join("\n")
    );
  });
});
