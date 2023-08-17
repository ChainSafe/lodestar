import {LodestarError} from "@lodestar/utils";
import {LogData, LogFormat} from "../../src/index.js";

type TestCase = {
  id: string;
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
    const error = new LodestarError({code: "SAMPLE_ERROR", data: {foo: "bar"}});
    error.stack = "$STACK";
    return {
      id: "error with metadata",
      opts: {format: "human", module: "SAMPLE"},
      message: "foo bar",
      error: error,
      output: {
        human: `[]                 \u001b[33mwarn\u001b[39m: foo bar code=SAMPLE_ERROR, data=foo=bar\n${error.stack}`,
        json: '{"error":{"code":"SAMPLE_ERROR","data":{"foo":"bar"},"stack":"$STACK"},"level":"warn","message":"foo bar","module":""}',
      },
    };
  },
];
