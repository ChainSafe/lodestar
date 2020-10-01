import {expect} from "chai";
import {LodestarError, toJson} from "../../src";

describe("Json helper", () => {
  interface ITestCase {
    id: string;
    arg: unknown;
    json: any;
  }
  const testCases: (ITestCase | (() => ITestCase))[] = [
    // Basic types
    {id: "undefined", arg: undefined, json: undefined},
    {id: "null", arg: null, json: "null"},
    {id: "boolean", arg: true, json: true},
    {id: "number", arg: 123, json: 123},
    {id: "bigint", arg: BigInt(123), json: "123"},
    {id: "string", arg: "hello", json: "hello"},
    {id: "symbol", arg: Symbol("foo"), json: "Symbol(foo)"},

    // Functions
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    {id: "function", arg: function () {}, json: "function () { }"},
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    {id: "arrow function", arg: () => {}, json: "() => { }"},
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    {id: "async function", arg: async function () {}, json: "async function () { }"},
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    {id: "async arrow function", arg: async () => {}, json: "async () => { }"},

    // Arrays
    {id: "array of basic types", arg: [1, 2, 3], json: [1, 2, 3]},
    {
      id: "array of arrays",
      arg: [
        [1, 2],
        [3, 4],
      ],
      json: [
        [1, 2],
        [3, 4],
      ],
    },

    // Objects
    {id: "object of basic types", arg: {a: 1, b: 2}, json: {a: 1, b: 2}},
    {id: "object of objects", arg: {a: {b: 1}}, json: {a: {b: 1}}},

    // Errors
    () => {
      const error = new Error("foo");
      return {
        id: "Normal error",
        arg: error,
        json: {
          message: error.message,
          stack: error.stack,
        },
      };
    },
    () => {
      class SampleError extends Error {
        data: string;
        constructor(data: string) {
          super("SAMPLE ERROR");
          this.data = data;
        }
      }
      const data = "foo";
      const error = new SampleError(data);
      return {
        id: "External error with metadata",
        arg: error,
        json: {
          data,
          message: error.message,
          stack: error.stack,
        },
      };
    },
    () => {
      const data = {code: "SOME_ERROR", foo: 123};
      const error = new LodestarError(data);
      return {
        id: "Lodestar error",
        arg: error,
        json: {
          ...data,
          message: error.message,
          stack: error.stack,
        },
      };
    },
  ];

  for (const testCase of testCases) {
    const {id, arg, json} = typeof testCase === "function" ? testCase() : testCase;
    it(id, () => {
      expect(toJson(arg)).to.deep.equal(json);
    });
  }
});
