import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {BeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {getBeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool/index.js";
import {IndexedError} from "../../../../../../src/api/impl/errors.js";
import {SyncCommitteeErrorCode} from "../../../../../../src/chain/errors/syncCommitteeError.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateCachedAltairState} from "../../../../../utils/state.js";

vi.mock("../../../../../../src/chain/validation/syncCommittee.js", async (importActual) => {
  const mod = await importActual<typeof import("../../../../../../src/chain/validation/syncCommittee.js")>();
  return {...mod, validateApiSyncCommittee: vi.fn()};
});

const {validateApiSyncCommittee} = await import("../../../../../../src/chain/validation/syncCommittee.js");

describe("api - beacon - submitPoolSyncCommitteeSignatures", () => {
  const altairForkEpoch = 0;
  const config = createChainForkConfig({
    ...configDef,
    ALTAIR_FORK_EPOCH: altairForkEpoch,
  });

  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconPoolApi>;
  let headState: BeaconStateView;

  beforeEach(() => {
    modules = getApiTestModules({config});
    headState = new BeaconStateView(generateCachedAltairState({slot: 0}, altairForkEpoch));
    modules.chain.getHeadState.mockReturnValue(headState);
    modules.chain.persistInvalidSszValue = vi.fn();
    Object.defineProperty(modules.chain, "syncCommitteeMessagePool", {
      value: {add: vi.fn()},
    });
    modules.network.publishSyncCommitteeSignature = vi.fn().mockResolvedValue(1);
    vi.mocked(validateApiSyncCommittee).mockResolvedValue(undefined);

    api = getBeaconPoolApi(modules);
  });

  it("rejects with 400 IndexedError when validatorIndex is not in the sync committee", async () => {
    const invalidSignature = {
      ...ssz.altair.SyncCommitteeMessage.defaultValue(),
      slot: 0,
      validatorIndex: 999999,
    };

    await expect(api.submitPoolSyncCommitteeSignatures({signatures: [invalidSignature]})).rejects.toThrow(
      IndexedError
    );

    try {
      await api.submitPoolSyncCommitteeSignatures({signatures: [invalidSignature]});
    } catch (e) {
      expect(e).toBeInstanceOf(IndexedError);
      const err = e as IndexedError;
      expect(err.status).toBe(400);
      expect(err.toObject().failures).toEqual([
        {
          index: 0,
          message: expect.stringContaining(SyncCommitteeErrorCode.VALIDATOR_NOT_IN_SYNC_COMMITTEE),
        },
      ]);
    }

    expect(modules.chain.syncCommitteeMessagePool.add).not.toHaveBeenCalled();
    expect(modules.network.publishSyncCommitteeSignature).not.toHaveBeenCalled();
    expect(modules.chain.persistInvalidSszValue).toHaveBeenCalled();
  });

  it("publishes valid signatures while reporting failures for non-committee validator indices", async () => {
    const syncCommittee = headState.getIndexedSyncCommittee(0);
    const validValidatorIndex = Array.from(syncCommittee.validatorIndexMap.keys())[0];

    const validSignature = {
      ...ssz.altair.SyncCommitteeMessage.defaultValue(),
      slot: 0,
      validatorIndex: validValidatorIndex,
    };
    const invalidSignature = {
      ...ssz.altair.SyncCommitteeMessage.defaultValue(),
      slot: 0,
      validatorIndex: 999999,
    };

    await expect(
      api.submitPoolSyncCommitteeSignatures({signatures: [validSignature, invalidSignature]})
    ).rejects.toThrow(IndexedError);

    expect(modules.chain.syncCommitteeMessagePool.add).toHaveBeenCalled();
    expect(modules.network.publishSyncCommitteeSignature).toHaveBeenCalled();
  });
});
