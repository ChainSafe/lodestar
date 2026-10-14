import {afterEach, describe, expect, it, vi} from "vitest";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {BeaconEngineCore} from "../../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {getApiTestModules} from "../../../../utils/api.js";

afterEach(() => vi.restoreAllMocks());

describe("api/validator - prepareBeaconCommitteeSubnet", () => {
  it("registers aggregation duties in the engine before preparing network subnets", async () => {
    const modules = getApiTestModules();
    let finishPreparation!: () => void;
    const prepared = new Promise<void>((resolve) => {
      finishPreparation = resolve;
    });
    const prepare = vi.fn<BeaconEngineCore["prepareBeaconCommitteeSubnets"]>().mockReturnValue(prepared);
    modules.chain.beaconEngine.prepareBeaconCommitteeSubnets = prepare;
    modules.network.prepareBeaconCommitteeSubnets = vi.fn().mockResolvedValue(undefined);
    const api = getValidatorApi(defaultApiOptions, modules);
    const subscriptions = [
      {validatorIndex: 1, slot: 1, isAggregator: true, committeesAtSlot: 2, committeeIndex: 0},
      {validatorIndex: 2, slot: 1, isAggregator: false, committeesAtSlot: 2, committeeIndex: 1},
    ];
    const committeeSubscriptions = [
      {validatorIndex: 1, slot: 1, isAggregator: true, subnet: 2},
      {validatorIndex: 2, slot: 1, isAggregator: false, subnet: 3},
    ];

    const request = api.prepareBeaconCommitteeSubnet({subscriptions});
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledExactlyOnceWith(committeeSubscriptions));
    expect(modules.network.prepareBeaconCommitteeSubnets).not.toHaveBeenCalled();

    finishPreparation();
    await request;
    expect(modules.network.prepareBeaconCommitteeSubnets).toHaveBeenCalledExactlyOnceWith(committeeSubscriptions);
  });
});
