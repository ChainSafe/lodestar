import {describe, it, expect} from "vitest";
import {goerliTestnetLogs, goerliTestnetDepositEvents} from "../../../utils/testnet.js";
import {parseDepositLog} from "../../../../src/eth1/utils/depositContract.js";

describe("eth1 / util / depositContract", () => {
  it("Should parse a raw deposit log", () => {
    const depositEvents = goerliTestnetLogs.map((log) => parseDepositLog(log));
    expect(depositEvents).toEqual(goerliTestnetDepositEvents);
  });
});
