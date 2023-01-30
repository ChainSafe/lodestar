import {expect} from "chai";
import sinon from "sinon";
import {shouldDeleteLogFile} from "../../../src/util/logger.js";

describe("shouldDeleteLogFile", function () {
  const prefix = "beacon";
  const extension = "log";

  const sandbox = sinon.createSandbox();
  beforeEach(() => {
    sandbox.useFakeTimers(new Date("2023-01-01"));
  });

  afterEach(() => {
    sandbox.restore();
  });
  const tcs: {logFile: string; maxFiles: number; now: number; result: boolean}[] = [
    // missing .log
    {
      logFile: "beacon-2022-12-25",
      maxFiles: 5,
      now: new Date("2023-01-01").getTime(),
      result: false,
    },
    // close to now
    {
      logFile: "beacon-2022-12-28.log",
      maxFiles: 5,
      now: new Date("2023-01-01").getTime(),
      result: false,
    },
    // incorrect date format
    {
      logFile: "beacon-20225-12-12.log",
      maxFiles: 5,
      now: new Date("2023-01-01").getTime(),
      result: false,
    },
    // maxFiles is 10 so close to now
    {
      logFile: "beacon-2022-12-25.log",
      maxFiles: 10,
      now: new Date("2023-01-01").getTime(),
      result: false,
    },
    {
      logFile: "beacon-2022-12-25.log",
      maxFiles: 5,
      now: new Date("2023-01-01").getTime(),
      result: true,
    },
  ];

  for (const {logFile, maxFiles, result} of tcs) {
    it(`should ${result ? "" : "not"} delete ${logFile}, maxFiles ${maxFiles}, today ${new Date()}`, () => {
      expect(shouldDeleteLogFile(prefix, extension, logFile, maxFiles)).to.be.equal(result);
    });
  }
});
