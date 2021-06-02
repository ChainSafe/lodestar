import {expect} from "chai";
import {ssz} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/minimal";
import {getENRForkID} from "../../../src/network/metadata";
import {ForkDigestContext} from "../../../src/util/forkDigestContext";

describe("network / metadata / getENRForkID", function () {
  it("should get enr fork id if not found next fork", () => {
    const genesisValidatorsRoot = ssz.Root.defaultValue();
    const forkDigestContext = new ForkDigestContext(config, genesisValidatorsRoot);
    const currentEpoch = 0;

    const enrForkID = getENRForkID(config, forkDigestContext, currentEpoch);
    expect(ssz.Version.equals(enrForkID.nextForkVersion, Buffer.from([255, 255, 255, 255])));
    expect(enrForkID.nextForkEpoch === Number.MAX_SAFE_INTEGER);
    // it's possible to serialize enr fork id
    ssz.phase0.ENRForkID.hashTreeRoot(enrForkID);
  });
});
