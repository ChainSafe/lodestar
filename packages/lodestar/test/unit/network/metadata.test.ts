import {expect} from "chai";
import {ssz} from "@chainsafe/lodestar-types";
import {getENRForkID} from "../../../src/network/metadata";
import {config} from "../../utils/config";

describe("network / metadata / getENRForkID", function () {
  it("should get enr fork id if not found next fork", () => {
    const currentEpoch = 0;

    const enrForkID = getENRForkID(config, currentEpoch);
    expect(ssz.Version.equals(enrForkID.nextForkVersion, Buffer.from([255, 255, 255, 255])));
    expect(enrForkID.nextForkEpoch === Number.MAX_SAFE_INTEGER);
    // it's possible to serialize enr fork id
    ssz.phase0.ENRForkID.hashTreeRoot(enrForkID);
  });
});
