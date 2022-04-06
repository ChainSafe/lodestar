/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import {LodestarError} from "../../../src";
import {logCtxToJson, logCtxToString} from "../../../src/logger/json.js";

describe("Json helper", () => {
  const circularReference = {};
  (circularReference as {myself: unknown}).myself = circularReference;

  describe("toJson", () => {
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
        json: ["[object]", "[object]"],
      },

      // Objects
      {id: "object of basic types", arg: {a: 1, b: 2}, json: {a: 1, b: 2}},
      {id: "object of objects", arg: {a: {b: 1}}, json: {a: "[object]"}},
      () => {
        const rootHex = "0x11111111111111111111111111111111";
        return {
          id: "Object with Uint8Array prop",
          arg: {root: fromHexString(rootHex)},
          json: {root: rootHex},
        };
      },

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
          id: "External error with metadata (ignored)",
          arg: error,
          json: {
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
            stack: error.stack,
          },
        };
      },
      () => {
        const code = "ERR_PARENT_UNKNOWN";
        const rootHex = "0x11111111111111111111111111111111";
        const error = new LodestarError({code, root: fromHexString(rootHex)});
        return {
          id: "Lodestar error with Uint8Array",
          arg: error,
          json: {
            code,
            root: rootHex,
            stack: error.stack,
          },
        };
      },

      // Circular references
      () => {
        const circularReference: any = {};
        circularReference.myself = circularReference;
        return {
          id: "circular reference",
          arg: circularReference,
          json: {myself: "[object]"},
        };
      },
    ];

    for (const testCase of testCases) {
      const {id, arg, json} = typeof testCase === "function" ? testCase() : testCase;
      it(id, () => {
        expect(logCtxToJson(arg)).to.deep.equal(json);
      });
    }
  });

  describe("toString", () => {
    const root = new Uint8Array(32);
    const rootHex = toHexString(root);

    interface ITestCase {
      id: string;
      json: unknown;
      output: string;
    }
    const testCases: (ITestCase | (() => ITestCase))[] = [
      // Basic types
      {id: "null", json: null, output: "null"},
      {id: "boolean", json: true, output: "true"},
      {id: "number", json: 123, output: "123"},
      {id: "string", json: "hello", output: "hello"},
      {id: "root", json: root, output: rootHex},

      // Arrays
      {id: "array of basic types", json: [1, 2, 3], output: "1, 2, 3"},
      {
        id: "array of arrays",
        json: [
          [1, 2],
          [3, 4],
        ],
        output: "[object], [object]",
      },

      // Objects
      {id: "object of basic types", json: {a: 1, b: "a", c: root}, output: `a=1, b=a, c=${rootHex}`},
      // eslint-disable-next-line quotes
      {id: "object of objects", json: {a: {b: 1}}, output: `a=[object]`},
      {
        id: "error metadata",
        json: {
          code: "ERR_PARENT_UNKNOWN",
          parentRoot: "0x1111111111111111111111111111111111",
        },
        output: "code=ERR_PARENT_UNKNOWN, parentRoot=0x1111111111111111111111111111111111",
      },

      // Circular references
      () => {
        const circularReference: any = {};
        circularReference.myself = circularReference;
        return {
          id: "circular reference",
          json: circularReference,
          output: "myself=[object]",
        };
      },
    ];

    for (const testCase of testCases) {
      const {id, json, output} = typeof testCase === "function" ? testCase() : testCase;
      it(id, () => {
        expect(logCtxToString(json)).to.equal(output);
      });
    }
  });
});
