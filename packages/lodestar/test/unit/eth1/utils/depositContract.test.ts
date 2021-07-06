import {expect} from "chai";
import {goerliTestnetLogs, goerliTestnetDepositEvents} from "../../../utils/testnet";
import {parseDepositLog} from "../../../../src/eth1/utils/depositContract";

describe("eth1 / util / depositContract", function () {
  it("Should parse a raw deposit log", () => {
    const depositEvents = goerliTestnetLogs.map((log) => parseDepositLog(log));
    expect(depositEvents).to.deep.equal(goerliTestnetDepositEvents);
  });
});
