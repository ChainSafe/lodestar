import {LodestarError} from "@lodestar/utils";
import {LogData, LogFormat} from "../../src/index.js";

type TestCase = {
  id: string;
  opts?: {module?: string};
  message: string;
  context?: LogData;
  error?: Error;
  output: {[P in LogFormat]: string};
};

/* eslint-disable quotes */
export const formatsTestCases: (TestCase | (() => TestCase))[] = [
  {
    id: "regular log with metadata",
    message: "foo bar",
    context: {meta: "data"},
    output: {
      human: "[]                 \u001b[33mwarn\u001b[39m: foo bar meta=data",
      json: '{"context":{"meta":"data"},"level":"warn","message":"foo bar","module":""}',
    },
  },

  {
    id: "regular log with big int metadata",
    message: "big int",
    context: {data: BigInt(1)},
    output: {
      human: "[]                 \u001b[33mwarn\u001b[39m: big int data=1",
      json: '{"context":{"data":"1"},"level":"warn","message":"big int","module":""}',
    },
  },

  () => {
    const error = new Error("err message");
    error.stack = "$STACK";
    return {
      id: "regular log with error",
      opts: {module: "test"},
      message: "foo bar",
      context: {},
      error: error,
      output: {
        human: `[test]             \u001b[33mwarn\u001b[39m: foo bar - err message\n${error.stack}`,
        json: '{"context":{},"error":{"message":"err message","stack":"$STACK"},"level":"warn","message":"foo bar","module":"test"}',
      },
    };
  },

  () => {
    const error = new Error("err message");
    error.stack = "$STACK";
    return {
      id: "regular log with error and metadata",
      opts: {module: "test"},
      message: "foo bar",
      context: {meta: "data"},
      error: error,
      output: {
        human: `[test]             \u001b[33mwarn\u001b[39m: foo bar meta=data - err message\n${error.stack}`,
        json: '{"context":{"meta":"data"},"error":{"message":"err message","stack":"$STACK"},"level":"warn","message":"foo bar","module":"test"}',
      },
    };
  },

  () => {
    const error = new LodestarError({code: "SAMPLE_ERROR", data: {foo: "bar"}});
    error.stack = "$STACK";
    return {
      id: "error with metadata",
      opts: {module: "test"},
      message: "foo bar",
      context: {},
      error: error,
      output: {
        human: `[test]             \u001b[33mwarn\u001b[39m: foo bar code=SAMPLE_ERROR, data=foo=bar\n${error.stack}`,
        json: '{"context":{},"error":{"code":"SAMPLE_ERROR","data":{"foo":"bar"},"stack":"$STACK"},"level":"warn","message":"foo bar","module":"test"}',
      },
    };
  },

  () => {
    const error = new LodestarError({code: "SAMPLE_ERROR", data: {foo: "bar"}});
    error.stack = "$STACK";
    return {
      id: "error and log with metadata",
      opts: {module: "test"},
      message: "foo bar",
      context: {meta: "data"},
      error: error,
      output: {
        human: `[test]             \u001b[33mwarn\u001b[39m: foo bar meta=data, code=SAMPLE_ERROR, data=foo=bar\n${error.stack}`,
        json: '{"context":{"meta":"data"},"error":{"code":"SAMPLE_ERROR","data":{"foo":"bar"},"stack":"$STACK"},"level":"warn","message":"foo bar","module":"test"}',
      },
    };
  },
];
