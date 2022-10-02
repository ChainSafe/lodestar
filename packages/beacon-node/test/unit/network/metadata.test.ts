import {expect} from "chai";
import {toHex} from "@lodestar/utils";
import {ssz} from "@lodestar/types";
import {getENRForkID} from "../../../src/network/metadata.js";
import {config} from "../../utils/config.js";

describe("network / metadata / getENRForkID", function () {
  // At 0, next fork is altair
  const currentEpoch = 0;
  const enrForkID = getENRForkID(config, currentEpoch);

  it("enrForkID.nextForkVersion", () => {
    expect(toHex(enrForkID.nextForkVersion)).equals(toHex(config.ALTAIR_FORK_VERSION));
  });

  it("enrForkID.nextForkEpoch", () => {
    expect(enrForkID.nextForkEpoch).equals(config.ALTAIR_FORK_EPOCH);
  });

  it("it's possible to serialize enr fork id", () => {
    ssz.phase0.ENRForkID.hashTreeRoot(enrForkID);
  });
});
