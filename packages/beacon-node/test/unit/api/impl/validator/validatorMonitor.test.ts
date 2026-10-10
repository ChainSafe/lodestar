import {afterEach, describe, expect, it, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {getLodestarApi} from "../../../../../src/api/impl/lodestar/index.js";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {accept} from "../../../../../src/chain/beaconEngine/gossipValidationResult.js";
import {Metrics, createMetrics} from "../../../../../src/metrics/index.js";
import {getApiTestModules} from "../../../../utils/api.js";

let metrics: Metrics | undefined;
afterEach(() => {
  metrics?.close();
  metrics = undefined;
  vi.restoreAllMocks();
});

function setup() {
  const modules = getApiTestModules();
  metrics = createMetrics({enabled: true, port: 0}, 0, [], {collectNodeMetrics: false});
  const api = getValidatorApi(defaultApiOptions, {...modules, metrics});
  return {modules, api};
}

describe("validator API monitor forwarding", () => {
  it("registers local validators only after network subscription succeeds", async () => {
    const {modules, api} = setup();
    modules.chain.beaconEngine.prepareBeaconCommitteeSubnets = vi.fn().mockResolvedValue(undefined);
    const register = vi.spyOn(modules.chain.beaconEngine, "registerLocalValidators");
    let finishSubscription!: () => void;
    modules.network.prepareBeaconCommitteeSubnets = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        finishSubscription = resolve;
      })
    );
    const subscriptions = [{validatorIndex: 1, slot: 1, isAggregator: true, committeesAtSlot: 1, committeeIndex: 0}];
    const pending = api.prepareBeaconCommitteeSubnet({subscriptions});
    await Promise.resolve();
    expect(modules.network.prepareBeaconCommitteeSubnets).toHaveBeenCalledOnce();
    expect(register).not.toHaveBeenCalled();
    finishSubscription();
    await pending;
    expect(register).toHaveBeenCalledExactlyOnceWith([1]);

    register.mockClear();
    modules.network.prepareBeaconCommitteeSubnets.mockRejectedValueOnce(new Error("subscription failed"));
    await expect(api.prepareBeaconCommitteeSubnet({subscriptions})).rejects.toThrow("subscription failed");
    expect(register).not.toHaveBeenCalled();
    expect(modules.chain.beaconEngine.prepareBeaconCommitteeSubnets).toHaveBeenCalledTimes(2);
  });

  it("preserves the metrics guard on validator registration", async () => {
    const modules = getApiTestModules();
    modules.network.prepareBeaconCommitteeSubnets = vi.fn().mockResolvedValue(undefined);
    modules.network.prepareSyncCommitteeSubnets = vi.fn().mockResolvedValue(undefined);
    const api = getValidatorApi(defaultApiOptions, {...modules, metrics: null});
    const register = vi.spyOn(modules.chain.beaconEngine, "registerLocalValidators");
    const registerSync = vi.spyOn(modules.chain.beaconEngine, "registerLocalValidatorsInSyncCommittee");
    await api.prepareBeaconCommitteeSubnet({
      subscriptions: [{validatorIndex: 1, slot: 1, isAggregator: true, committeesAtSlot: 1, committeeIndex: 0}],
    });
    await api.prepareSyncCommitteeSubnets({
      subscriptions: [{validatorIndex: 1, syncCommitteeIndices: [0], untilEpoch: 2}],
    });
    expect(register).not.toHaveBeenCalled();
    expect(registerSync).not.toHaveBeenCalled();
    expect(modules.chain.beaconEngine.prepareBeaconCommitteeSubnets).toHaveBeenCalledOnce();
  });

  it("forwards sync monitoring subscriptions after successful network preparation", async () => {
    const {modules, api} = setup();
    const register = vi.spyOn(modules.chain.beaconEngine, "registerLocalValidatorsInSyncCommittee");
    const subscriptions = [{validatorIndex: 1, syncCommitteeIndices: [0, 1], untilEpoch: 5}];
    modules.network.prepareSyncCommitteeSubnets = vi
      .fn()
      .mockResolvedValue(undefined)
      .mockRejectedValueOnce(new Error("subscription failed"));
    await expect(api.prepareSyncCommitteeSubnets({subscriptions})).rejects.toThrow("subscription failed");
    expect(register).not.toHaveBeenCalled();
    await api.prepareSyncCommitteeSubnets({subscriptions});
    expect(register).toHaveBeenCalledExactlyOnceWith([{validatorIndex: 1, untilEpoch: 5}]);
  });

  it("reports aggregate publication metadata only after publication succeeds", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(12_000);
    const {modules, api} = setup();
    const aggregate = modules.config.getForkTypes(0).SignedAggregateAndProof.defaultValue();
    const indexedAttestation = ssz.phase0.IndexedAttestation.defaultValue();
    indexedAttestation.attestingIndices = [1, 2];
    modules.chain.beaconEngine.validateApiAggregateAndProof = vi.fn().mockResolvedValue(accept({indexedAttestation}));
    const report = vi.spyOn(modules.chain.beaconEngine, "onPoolSubmitAggregatedAttestation");
    let finishPublication!: (sentPeers: number) => void;
    modules.network.publishBeaconAggregateAndProof = vi.fn().mockReturnValue(
      new Promise<number>((resolve) => {
        finishPublication = resolve;
      })
    );
    const pending = api.publishAggregateAndProofsV2({signedAggregateAndProofs: [aggregate]});
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(modules.network.publishBeaconAggregateAndProof).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
    now.mockReturnValue(20_000);
    finishPublication(3);
    await pending;
    expect(report).toHaveBeenCalledWith(
      12,
      {
        attestingIndices: [1, 2],
        data: {slot: 0, index: 0, target: indexedAttestation.data.target},
      },
      3
    );
    expect(report.mock.calls[0][1]).not.toHaveProperty("signature");
    report.mockClear();
    modules.network.publishBeaconAggregateAndProof.mockRejectedValueOnce(new Error("publish failed"));
    await expect(api.publishAggregateAndProofsV2({signedAggregateAndProofs: [aggregate]})).rejects.toThrow();
    expect(report).not.toHaveBeenCalled();
  });

  it("queries monitored validators from the engine", async () => {
    const modules = getApiTestModules();
    modules.chain.beaconEngine.getMonitoredValidatorIndices = vi.fn().mockResolvedValue([1, 2]);
    const api = getLodestarApi(modules);
    expect(await api.getMonitoredValidatorIndices()).toEqual({data: [1, 2]});
  });
});
