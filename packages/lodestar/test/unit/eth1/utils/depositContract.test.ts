import {expect} from "chai";
import {goerliMedallaLogs, goerliMedallaDepositEvents, getMedallaConfig} from "../../../utils/medalla";
import {parseDepositLog} from "../../../../src/eth1/utils/depositContract";

describe("eth1 / util / eth1Vote", function () {
  it("Should parse a raw deposit log", () => {
    const config = getMedallaConfig();
    const depositEvents = goerliMedallaLogs.map((log) => parseDepositLog(config, log));
    expect(depositEvents).to.deep.equal(goerliMedallaDepositEvents);
  });
});
