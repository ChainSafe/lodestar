import {beforeEach, describe, expect, it, vi} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName, MAX_COMMITTEES_PER_SLOT_PQ} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {AggregateAlreadySeen} from "../../../../../src/api/impl/errors.js";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {SyncState} from "../../../../../src/sync/interface.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";

describe("api/validator - getAggregatedAttestationV2 from pq", () => {
  const config = createChainForkConfig({...defaultChainConfig, GLOAS_FORK_EPOCH: 0, PQ_FORK_EPOCH: 0});
  const slot = 0;
  const committeeIndex = 1;
  const data = ssz.phase0.AttestationData.defaultValue();
  const attestationDataRoot = ssz.phase0.AttestationData.hashTreeRoot(data);
  const aggregationBits = BitArray.fromBoolArray([true, false, true, true]);
  const proof = Uint8Array.from([1, 2, 3]);

  let modules: ApiTestModules;
  let api: ReturnType<typeof getValidatorApi>;
  const isKnown = vi.fn();

  beforeEach(() => {
    modules = getApiTestModules({config});
    api = getValidatorApi(defaultApiOptions, modules);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);
    isKnown.mockReset();
    Object.assign(modules.chain, {
      pqAttestationPool: {
        getAggregate: vi
          .fn()
          .mockResolvedValue({data, aggregate: {aggregationBits, aggregate: {proof, claims: new Uint8Array(0)}}}),
      },
      seenAggregatedAttestations: {isKnown},
    });
  });

  it("hands an aggregator its committee's aggregate beside the proof", async () => {
    isKnown.mockReturnValue(false);

    const res = await api.getAggregatedAttestationV2({attestationDataRoot, slot, committeeIndex});

    expect(res.meta).toEqual({version: ForkName.pq});
    expect(res.data).toEqual({
      aggregate: {
        aggregationBits,
        data,
        committeeBits: BitArray.fromSingleBit(MAX_COMMITTEES_PER_SLOT_PQ, committeeIndex),
      },
      proof,
    });
  });

  it("has none for an aggregator whose attesters an aggregate seen includes", async () => {
    isKnown.mockReturnValue(true);

    await expect(api.getAggregatedAttestationV2({attestationDataRoot, slot, committeeIndex})).rejects.toBeInstanceOf(
      AggregateAlreadySeen
    );
    expect(isKnown).toHaveBeenCalledExactlyOnceWith(
      data.target.epoch,
      committeeIndex,
      expect.any(String),
      aggregationBits
    );
  });
});
