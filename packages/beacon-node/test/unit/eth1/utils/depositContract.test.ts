import {describe, expect, it} from "vitest";
import {parseDepositLog} from "../../../../src/eth1/utils/depositContract.js";
import {goerliTestnetDepositEvents, goerliTestnetLogs} from "../../../utils/testnet.js";

describe("eth1 / util / depositContract", () => {
  it("Should parse a raw deposit log", () => {
    const depositEvents = goerliTestnetLogs.map((log) => parseDepositLog(log));
    expect(depositEvents).toEqual(goerliTestnetDepositEvents);
  });
});
