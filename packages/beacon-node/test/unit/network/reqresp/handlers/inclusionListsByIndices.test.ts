import {PeerId} from "@libp2p/interface";
import {beforeEach, describe, expect, it} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {testLogger} from "@lodestar/logger/test-utils";
import {INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import {ResponseOutgoing} from "@lodestar/reqresp";
import {ssz} from "@lodestar/types";
import {IBeaconChain} from "../../../../../src/chain/index.js";
import {InclusionListStore} from "../../../../../src/chain/opPools/inclusionListStore.js";
import {onInclusionListsByIndices} from "../../../../../src/network/reqresp/handlers/inclusionListsByIndices.js";

describe("network / reqresp / handlers / InclusionListsByIndices", () => {
  const slot = 100;
  const dependentRoot = Buffer.alloc(32, 0xaa);
  const peerId = {toString: () => "test-peer"} as PeerId;
  const config = {
    MIN_SLOTS_FOR_INCLUSION_LISTS_REQUESTS: 1,
    MAX_REQUEST_INCLUSION_LIST: 16,
    HEZE_FORK_EPOCH: 0,
    getForkBoundaryAtEpoch: () => ({fork: "heze", epoch: 0}),
  } as unknown as BeaconConfig;

  let store: InclusionListStore;

  beforeEach(() => {
    store = new InclusionListStore(config);
    const signedInclusionList = ssz.heze.SignedInclusionList.defaultValue();
    signedInclusionList.message.slot = slot;
    signedInclusionList.message.validatorIndex = 1;
    signedInclusionList.message.dependentRoot = dependentRoot;
    store.process(signedInclusionList, [0], true);
  });

  async function request(currentSlot: number): Promise<ResponseOutgoing[]> {
    const chain = {
      config,
      logger: testLogger(),
      clock: {currentSlot},
      inclusionListStore: store,
    } as unknown as IBeaconChain;
    const indices = BitArray.fromBitLen(INCLUSION_LIST_COMMITTEE_SIZE);
    indices.set(0, true);

    const responses: ResponseOutgoing[] = [];
    for await (const response of onInclusionListsByIndices({slot, dependentRoot, indices}, chain, peerId, "test")) {
      responses.push(response);
    }
    return responses;
  }

  it("serves inclusion lists inside the request window", async () => {
    expect(await request(slot + 1)).toHaveLength(1);
  });

  it("does not serve inclusion lists kept past the request window", async () => {
    store.prune(slot + 2);
    expect(store.size).toBe(1);

    expect(await request(slot + 2)).toHaveLength(0);
  });
});
