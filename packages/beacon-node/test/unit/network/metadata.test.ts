import {expect} from "chai";
import {toHex} from "@lodestar/utils";
import {ssz} from "@lodestar/types";
import {config as chainConfig} from "@lodestar/config/default";
import {createIBeaconConfig} from "@lodestar/config";
import {getENRForkID} from "../../../src/network/metadata.js";
import {ZERO_HASH} from "../../../src/constants/constants.js";

/* eslint-disable @typescript-eslint/naming-convention */

describe("network / metadata / getENRForkID", function () {
  // At 0, next fork is altair
  const currentEpoch = 0;
  // Schedule altair so it's picked up as next fork
  // default config with ZERO_HASH as genesisValidatorsRoot
  const config = createIBeaconConfig({...chainConfig, ALTAIR_FORK_EPOCH: 10}, ZERO_HASH);
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
