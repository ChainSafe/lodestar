import {expect} from "chai";
import {goerliPyrmontLogs, goerliPyrmontDepositEvents, getPyrmontConfig} from "../../../utils/pyrmont";
import {parseDepositLog} from "../../../../src/eth1/utils/depositContract";

describe("eth1 / util / depositContract", function () {
  it("Should parse a raw deposit log", () => {
    const config = getPyrmontConfig();
    const depositEvents = goerliPyrmontLogs.map((log) => parseDepositLog(config, log));
    expect(depositEvents).to.deep.equal(goerliPyrmontDepositEvents);
  });
});
