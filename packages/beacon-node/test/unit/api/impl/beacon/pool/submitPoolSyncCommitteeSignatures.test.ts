import {setImmediate as yieldToIO} from "node:timers/promises";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ForkName, SYNC_COMMITTEE_SUBNET_COUNT, SYNC_COMMITTEE_SUBNET_SIZE} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {getBeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool/index.js";
import {IndexedError} from "../../../../../../src/api/impl/errors.js";
import {SyncCommitteeErrorCode} from "../../../../../../src/chain/errors/index.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateCachedAltairState} from "../../../../../utils/state.js";

vi.mock("../../../../../../src/chain/validation/syncCommittee.js", async (importActual) => {
  const mod = await importActual<typeof import("../../../../../../src/chain/validation/syncCommittee.js")>();
  return {...mod, validateApiSyncCommittee: vi.fn()};
});

const {validateApiSyncCommittee} = await import("../../../../../../src/chain/validation/syncCommittee.js");

describe("api - beacon - submitPoolSyncCommitteeSignatures", () => {
  const config = createChainForkConfig({...configDef, ALTAIR_FORK_EPOCH: 0});

  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconPoolApi>;
  let headState: BeaconStateView;
  let syncCommitteeMessagePoolAdd: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    modules = getApiTestModules({config});
    headState = new BeaconStateView(generateCachedAltairState({slot: 0}));
    modules.chain.getHeadState.mockReturnValue(headState);
    modules.chain.persistInvalidSszValue = vi.fn();
    syncCommitteeMessagePoolAdd = vi.fn();
    Object.defineProperty(modules.chain, "syncCommitteeMessagePool", {value: {add: syncCommitteeMessagePoolAdd}});
    modules.network.publishSyncCommitteeSignature = vi.fn().mockResolvedValue(1);
    vi.mocked(validateApiSyncCommittee).mockResolvedValue(undefined);

    api = getBeaconPoolApi(modules);
  });

  function getNonMemberIndex(): number {
    const validatorIndexMap = headState.getIndexedSyncCommittee(0).validatorIndexMap;
    let validatorIndex = 0;
    while (validatorIndexMap.has(validatorIndex)) validatorIndex++;
    return validatorIndex;
  }

  it.each([
    {name: "out of range", getValidatorIndex: () => 999999},
    {name: "not in the sync committee", getValidatorIndex: getNonMemberIndex},
  ])("returns 400 IndexedError when validator index is $name", async ({getValidatorIndex}) => {
    const validatorIndex = getValidatorIndex();
    const signature = {...ssz.altair.SyncCommitteeMessage.defaultValue(), slot: 0, validatorIndex};

    const err = await api.submitPoolSyncCommitteeSignatures({signatures: [signature]}).catch((e) => e);

    expect(err).toBeInstanceOf(IndexedError);
    expect((err as IndexedError).statusCode).toBe(400);
    expect((err as IndexedError).failures).toEqual([
      {index: 0, message: SyncCommitteeErrorCode.VALIDATOR_NOT_IN_SYNC_COMMITTEE},
    ]);
    expect(validateApiSyncCommittee).not.toHaveBeenCalled();
    expect(syncCommitteeMessagePoolAdd).not.toHaveBeenCalled();
    expect(modules.network.publishSyncCommitteeSignature).not.toHaveBeenCalled();
  });

  it("still publishes valid signatures in the same request", async () => {
    const memberIndex = headState.getIndexedSyncCommittee(0).validatorIndexMap.keys().next().value as number;
    const valid = {...ssz.altair.SyncCommitteeMessage.defaultValue(), slot: 0, validatorIndex: memberIndex};
    const invalid = {...ssz.altair.SyncCommitteeMessage.defaultValue(), slot: 0, validatorIndex: 999999};

    const err = await api.submitPoolSyncCommitteeSignatures({signatures: [invalid, valid]}).catch((e) => e);

    expect(err).toBeInstanceOf(IndexedError);
    expect((err as IndexedError).failures.map((f) => f.index)).toEqual([0]);
    expect(syncCommitteeMessagePoolAdd).toHaveBeenCalled();
    expect(modules.network.publishSyncCommitteeSignature).toHaveBeenCalledWith(valid, expect.any(Number));
  });

  it("starts every subnet publication and preserves indexed failures", async () => {
    const modules = getApiTestModules();
    const state = {
      forkName: ForkName.altair,
      getIndexedSyncCommittee: () => ({
        validatorIndexMap: new Map([
          [0, Array.from({length: SYNC_COMMITTEE_SUBNET_COUNT}, (_, subnet) => subnet * SYNC_COMMITTEE_SUBNET_SIZE)],
        ]),
      }),
    } as unknown as ReturnType<typeof modules.chain.getHeadState>;
    modules.chain.getHeadState.mockReturnValue(state);
    Object.defineProperty(modules.chain, "syncCommitteeMessagePool", {value: {add: vi.fn()}});
    vi.mocked(validateApiSyncCommittee).mockResolvedValue(undefined);
    const pending = defer<number>();
    const failure = new Error("subnet refused");
    const publish = vi.fn().mockRejectedValueOnce(failure).mockReturnValue(pending.promise);
    modules.network.publishSyncCommitteeSignature = publish;
    const api = getBeaconPoolApi(modules);
    const submitted = api.submitPoolSyncCommitteeSignatures({
      signatures: Array.from({length: 33}, () => ssz.altair.SyncCommitteeMessage.defaultValue()),
    });
    const result = expect(submitted).rejects.toMatchObject({failures: [{index: 0, message: failure.message}]});
    try {
      await yieldToIO();
      expect(validateApiSyncCommittee).toHaveBeenCalledTimes(33);
      expect(publish).toHaveBeenCalledTimes(33 * SYNC_COMMITTEE_SUBNET_COUNT);
    } finally {
      pending.resolve(1);
      await result;
    }
    expect(publish).toHaveBeenCalledTimes(33 * SYNC_COMMITTEE_SUBNET_COUNT);
  });
});
