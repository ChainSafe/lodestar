import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, createCachedBeaconState} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {getBeaconStateApi} from "../../../../../../src/api/impl/beacon/state/index.js";
import {getStateResponseWithRegen} from "../../../../../../src/api/impl/beacon/state/utils.js";
import {ApiError} from "../../../../../../src/api/impl/errors.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";

vi.mock("../../../../../../src/api/impl/beacon/state/utils.js", async (importActual) => ({
  ...(await importActual<typeof import("../../../../../../src/api/impl/beacon/state/utils.js")>()),
  getStateResponseWithRegen: vi.fn(),
}));

describe("api - beacon - builder pending payments and withdrawals", () => {
  const withdrawal: gloas.BuilderPendingWithdrawal = {
    feeRecipient: new Uint8Array(20).fill(1),
    amount: 32_000_000_000,
    builderIndex: 7,
  };
  const payment: gloas.BuilderPendingPayment = {weight: 64_000_000_000, withdrawal, proposerIndex: 3};
  const payments = ssz.gloas.BuilderPendingPayments.defaultValue();
  payments[0] = payment;
  payments[SLOTS_PER_EPOCH] = {...payment, proposerIndex: 4};
  const cases = [
    {
      method: "getBuilderPendingPayments",
      data: payments,
      bytes: ssz.gloas.BuilderPendingPayments.serialize(payments),
    },
    {
      method: "getBuilderPendingWithdrawals",
      data: [withdrawal],
      bytes: ssz.gloas.BuilderPendingWithdrawals.serialize([withdrawal]),
    },
  ] as const;
  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconStateApi>;

  beforeAll(() => {
    modules = getApiTestModules();
    api = getBeaconStateApi(modules);
  });

  beforeEach(() => {
    vi.mocked(getStateResponseWithRegen).mockReset();
  });

  describe.each([ForkName.gloas, ForkName.heze] as const)("%s", (fork) => {
    let state: BeaconStateView;

    beforeEach(() => {
      const stateView = ssz[fork].BeaconState.defaultViewDU();
      stateView.builderPendingPayments = ssz.gloas.BuilderPendingPayments.toViewDU(payments);
      stateView.builderPendingWithdrawals.push(ssz.gloas.BuilderPendingWithdrawal.toViewDU(withdrawal));
      state = new BeaconStateView(
        createCachedBeaconState(
          stateView,
          {config: createBeaconConfig(getConfig(fork), stateView.genesisValidatorsRoot), pubkeyCache},
          {skipSyncCommitteeCache: true}
        )
      );
    });

    describe.each(cases)("$method", ({method, data, bytes}) => {
      it.each([false, true])("returns the complete state field, returnBytes=%s", async (returnBytes) => {
        const metadata = {executionOptimistic: true, finalized: false};
        vi.mocked(getStateResponseWithRegen).mockResolvedValue({state, ...metadata});
        const stateRoot = `0x${"ab".repeat(32)}`;

        const result = await api[method]({stateId: stateRoot}, {returnBytes});

        expect(getStateResponseWithRegen).toHaveBeenCalledWith(modules.chain, modules.sync, stateRoot);
        expect(result).toEqual({data: returnBytes ? bytes : data, meta: {...metadata, version: fork}});
      });

      it("preserves finalized metadata", async () => {
        vi.mocked(getStateResponseWithRegen).mockResolvedValue({state, executionOptimistic: false, finalized: true});

        expect(await api[method]({stateId: "finalized"})).toEqual({
          data,
          meta: {executionOptimistic: false, finalized: true, version: fork},
        });
      });
    });
  });

  it.each([false, true])("returns an empty withdrawal list, returnBytes=%s", async (returnBytes) => {
    const stateView = ssz.gloas.BeaconState.defaultViewDU();
    const state = new BeaconStateView(
      createCachedBeaconState(
        stateView,
        {config: createBeaconConfig(getConfig(ForkName.gloas), stateView.genesisValidatorsRoot), pubkeyCache},
        {skipSyncCommitteeCache: true}
      )
    );
    vi.mocked(getStateResponseWithRegen).mockResolvedValue({state, executionOptimistic: false, finalized: false});

    expect(await api.getBuilderPendingWithdrawals({stateId: "head"}, {returnBytes})).toEqual({
      data: returnBytes ? new Uint8Array() : [],
      meta: {executionOptimistic: false, finalized: false, version: ForkName.gloas},
    });
  });

  describe.each(cases)("$method", ({method}) => {
    it("rejects pre-Gloas states", async () => {
      const stateView = ssz.fulu.BeaconState.defaultViewDU();
      const state = new BeaconStateView(
        createCachedBeaconState(
          stateView,
          {config: createBeaconConfig(getConfig(ForkName.fulu), stateView.genesisValidatorsRoot), pubkeyCache},
          {skipSyncCommitteeCache: true}
        )
      );
      vi.mocked(getStateResponseWithRegen).mockResolvedValue({state, executionOptimistic: false, finalized: true});

      await expect(api[method]({stateId: "finalized"})).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("pre-gloas state fork=fulu"),
      });
    });

    it("preserves state lookup errors", async () => {
      const error = new ApiError(404, "State not found");
      vi.mocked(getStateResponseWithRegen).mockRejectedValue(error);

      await expect(api[method]({stateId: "head"})).rejects.toBe(error);
    });
  });
});
