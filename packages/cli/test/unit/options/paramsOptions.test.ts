import {expect} from "chai";
import {parseBeaconParamsArgs} from "../../../src/options/paramsOptions";
import {IBeaconParamsUnparsed} from "../../../src/config/types";

describe("options / paramsOptions", () => {
  it("Should parse BeaconParams", () => {
    // Cast to match the expected fully defined type
    const beaconParamsArgs = {
      "params.GENESIS_FORK_VERSION": "0x00000001",
      "params.DEPOSIT_CONTRACT_ADDRESS": "0x1234567890123456789012345678901234567890",
    };

    const expectedBeaconParams: Partial<IBeaconParamsUnparsed> = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      GENESIS_FORK_VERSION: "0x00000001",
      // eslint-disable-next-line @typescript-eslint/naming-convention
      DEPOSIT_CONTRACT_ADDRESS: "0x1234567890123456789012345678901234567890",
    };

    const beaconParams = parseBeaconParamsArgs(beaconParamsArgs);
    expect(beaconParams).to.deep.equal(expectedBeaconParams);
  });
});
