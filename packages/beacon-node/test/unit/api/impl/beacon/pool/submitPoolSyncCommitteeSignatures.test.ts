import {setImmediate as yieldToIO} from "node:timers/promises";
import {describe, expect, it, vi} from "vitest";
import {ForkName, SYNC_COMMITTEE_SUBNET_COUNT, SYNC_COMMITTEE_SUBNET_SIZE} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {getBeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool/index.js";
import {validateApiSyncCommittee} from "../../../../../../src/chain/validation/syncCommittee.js";
import {getApiTestModules} from "../../../../../utils/api.js";

vi.mock("../../../../../../src/chain/validation/syncCommittee.js");

describe("api - beacon - submitPoolSyncCommitteeSignatures", () => {
  it("retains submission capacity until every subnet settles after one fails", async () => {
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
      expect(validateApiSyncCommittee).toHaveBeenCalledTimes(32);
      expect(publish).toHaveBeenCalledTimes(32 * SYNC_COMMITTEE_SUBNET_COUNT);
    } finally {
      pending.resolve(1);
      await result;
    }
    expect(publish).toHaveBeenCalledTimes(33 * SYNC_COMMITTEE_SUBNET_COUNT);
  });
});
