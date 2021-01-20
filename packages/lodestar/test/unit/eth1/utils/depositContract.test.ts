import {expect} from "chai";
import {goerliTestnetLogs, goerliTestnetDepositEvents, getTestnetConfig} from "../../../utils/testnet";
import {parseDepositLog} from "../../../../src/eth1/utils/depositContract";

describe("eth1 / util / depositContract", function () {
  it("Should parse a raw deposit log", () => {
    const config = getTestnetConfig();
    const depositEvents = goerliTestnetLogs.map((log) => parseDepositLog(config, log));
    expect(depositEvents).to.deep.equal(goerliTestnetDepositEvents);
  });
});
