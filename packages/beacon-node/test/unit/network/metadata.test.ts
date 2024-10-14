import {describe, it, expect} from "vitest";
import {toHex} from "@lodestar/utils";
import {ssz} from "@lodestar/types";
import {getENRForkID} from "../../../src/network/metadata.js";
import {config} from "../../utils/config.js";

describe("network / metadata / getENRForkID", () => {
  // At 0, next fork is altair
  const currentEpoch = 0;
  const enrForkID = getENRForkID(config, currentEpoch);

  it("enrForkID.nextForkVersion", () => {
    expect(toHex(enrForkID.nextForkVersion)).toBe(toHex(config.ALTAIR_FORK_VERSION));
  });

  it("enrForkID.nextForkEpoch", () => {
    expect(enrForkID.nextForkEpoch).toBe(config.ALTAIR_FORK_EPOCH);
  });

  it("it's possible to serialize enr fork id", () => {
    ssz.phase0.ENRForkID.hashTreeRoot(enrForkID);
  });
});
