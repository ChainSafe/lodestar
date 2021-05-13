import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/minimal";
import {getENRForkID} from "../../../../src/network/metadata/utils";
import {ForkDigestContext} from "../../../../src/util/forkDigestContext";

describe("network / metadata / utils / getENRForkID", function () {
  it("should get enr fork id if not found next fork", () => {
    const genesisValidatorsRoot = config.types.Root.defaultValue();
    const forkDigestContext = new ForkDigestContext(config, genesisValidatorsRoot);
    const currentEpoch = 0;

    const enrForkID = getENRForkID(config, forkDigestContext, currentEpoch);
    expect(config.types.Version.equals(enrForkID.nextForkVersion, Buffer.from([255, 255, 255, 255])));
    expect(enrForkID.nextForkEpoch === Number.MAX_SAFE_INTEGER);
    // it's possible to serialize enr fork id
    config.types.phase0.ENRForkID.hashTreeRoot(enrForkID);
  });
});
