import {beforeEach, describe, expect, it, vi} from "vitest";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {phase0} from "@lodestar/types";
import {getBeaconStateApi} from "../../../../../../src/api/impl/beacon/state/index.js";
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
    modules.forkChoice.getFinalizedCheckpoint.mockReturnValue({rootHex: "0xbb", epoch: 0});
    vi.spyOn(modules.chain.regen, "getStateSync").mockReturnValue(state);
  });

  it("returns active_ongoing validator when filtering by group status active with ids", async () => {
    const {data} = await api.getStateValidators({
      stateId: "head",
      validatorIds: [0],
      statuses: ["active"],
    });

    expect(data).toHaveLength(1);
    expect(data[0].index).toBe(0);
    expect(data[0].status).toBe("active_ongoing");
  });

  it("returns active_ongoing validator when filtering by fine-grained status with ids", async () => {
    const {data} = await api.getStateValidators({
      stateId: "head",
      validatorIds: [0],
      statuses: ["active_ongoing"],
    });

    expect(data).toHaveLength(1);
    expect(data[0].status).toBe("active_ongoing");
  });

  it("excludes active validator when filtering by unrelated group status with ids", async () => {
    const {data} = await api.getStateValidators({
      stateId: "head",
      validatorIds: [0],
      statuses: ["pending"],
    });

    expect(data).toHaveLength(0);
  });

  it("matches pending / exited / withdrawal group statuses with ids", async () => {
    const originalGetValidator = state.getValidator.bind(state);
    const overlays = new Map<number, Partial<phase0.Validator>>([
      [0, {activationEpoch: 10, activationEligibilityEpoch: FAR_FUTURE_EPOCH}],
      [1, {activationEpoch: 0, exitEpoch: 0, withdrawableEpoch: 10, slashed: false}],
      [2, {activationEpoch: 0, exitEpoch: 0, withdrawableEpoch: 0, effectiveBalance: 0}],
    ]);
    vi.spyOn(state, "getValidator").mockImplementation((index) => {
      const validator = originalGetValidator(index);
      const overlay = overlays.get(index);
      return overlay ? {...validator, ...overlay} : validator;
    });

    const cases: {id: number; group: "pending" | "exited" | "withdrawal"; expected: string}[] = [
      {id: 0, group: "pending", expected: "pending_initialized"},
      {id: 1, group: "exited", expected: "exited_unslashed"},
      {id: 2, group: "withdrawal", expected: "withdrawal_done"},
    ];

    for (const {id, group, expected} of cases) {
      const {data} = await api.getStateValidators({
        stateId: "head",
        validatorIds: [id],
        statuses: [group],
      });
      expect(data, `ids+[${group}] should include index ${id}`).toHaveLength(1);
      expect(data[0].status).toBe(expected);
    }
  });
});
