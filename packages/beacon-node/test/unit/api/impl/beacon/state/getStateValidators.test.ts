import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {BeaconStateView} from "@lodestar/state-transition";
import {getBeaconStateApi} from "../../../../../../src/api/impl/beacon/state/index.js";
import {ZERO_HASH} from "../../../../../../src/constants/index.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateCachedAltairState} from "../../../../../utils/state.js";
import {generateProtoBlock} from "../../../../../utils/typeGenerator.js";

describe("getStateValidators status filtering with ids", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconStateApi>;
  let state: BeaconStateView;

  beforeEach(() => {
    modules = getApiTestModules();
    api = getBeaconStateApi(modules);

    // Validators are active_ongoing (activationEpoch 0, exitEpoch FAR_FUTURE)
    state = new BeaconStateView(generateCachedAltairState());
    modules.forkChoice.getHead.mockReturnValue(
      generateProtoBlock({stateRoot: "0xaa", executionStatus: ExecutionStatus.Valid})
    );
    modules.forkChoice.getFinalizedCheckpoint.mockReturnValue({
      root: ZERO_HASH,
      rootHex: "0xbb",
      epoch: 0,
    });
    vi.spyOn(modules.chain.regen, "getStateSync").mockReturnValue(state);
  });

  it("returns active_ongoing validator when filtering by group status active with ids", async () => {
    const {data} = (await api.getStateValidators({
      stateId: "head",
      validatorIds: [0],
      statuses: ["active"],
    })) as {data: routes.beacon.ValidatorResponse[]};

    expect(data).toHaveLength(1);
    expect(data[0].index).toBe(0);
    expect(data[0].status).toBe("active_ongoing");
  });

  it("returns active_ongoing validator when filtering by fine-grained status with ids", async () => {
    const {data} = (await api.getStateValidators({
      stateId: "head",
      validatorIds: [0],
      statuses: ["active_ongoing"],
    })) as {data: routes.beacon.ValidatorResponse[]};

    expect(data).toHaveLength(1);
    expect(data[0].status).toBe("active_ongoing");
  });

  it("excludes active validator when filtering by unrelated group status with ids", async () => {
    const {data} = (await api.getStateValidators({
      stateId: "head",
      validatorIds: [0],
      statuses: ["pending"],
    })) as {data: routes.beacon.ValidatorResponse[]};

    expect(data).toHaveLength(0);
  });
});
