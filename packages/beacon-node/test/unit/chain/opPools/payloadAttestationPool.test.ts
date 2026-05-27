import {beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/blst";
import {toHexString} from "@chainsafe/ssz";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {PTC_SIZE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {PayloadAttestationPool} from "../../../../src/chain/opPools/payloadAttestationPool.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";
import {getMockedClock} from "../../../mocks/clock.js";

describe("chain / opPools / PayloadAttestationPool", () => {
  const config = createChainForkConfig({
    ...defaultChainConfig,
    GLOAS_FORK_EPOCH: 0,
  });
  const clockStub = getMockedClock();
  vi.spyOn(clockStub, "slotWithPastTolerance").mockReturnValue(0);

  const slot = SLOTS_PER_EPOCH;
  const beaconBlockRoot = Buffer.alloc(32, 1);
  const sk = SecretKey.fromBytes(Buffer.alloc(32, 9));
  const data: gloas.PayloadAttestationData = {
    beaconBlockRoot,
    slot,
    payloadPresent: true,
    blobDataAvailable: true,
  };
  const signature = sk.sign(ssz.gloas.PayloadAttestationData.hashTreeRoot(data)).toBytes();
  const message: gloas.PayloadAttestationMessage = {
    data,
    validatorIndex: 42,
    signature,
  };
  const attDataRootHex = toHexString(ssz.gloas.PayloadAttestationData.hashTreeRoot(data));

  let pool: PayloadAttestationPool;

  beforeEach(() => {
    pool = new PayloadAttestationPool(config, clockStub);
  });

  it("sets every duplicate PTC position when a validator occupies multiple seats", () => {
    const duplicateIndices = [2, 5, 7];
    const outcome = pool.add(message, attDataRootHex, duplicateIndices);
    expect(outcome).toBe(InsertOutcome.NewData);

    const [aggregate] = pool.getPayloadAttestationsForBlock(toHexString(beaconBlockRoot), slot);
    expect(aggregate).toBeDefined();
    for (let i = 0; i < PTC_SIZE; i++) {
      expect(aggregate.aggregationBits.get(i)).toBe(duplicateIndices.includes(i));
    }
    expect(aggregate.aggregationBits.getTrueBitIndexes()).toEqual(duplicateIndices);
  });

  it("re-adding the same validator with overlapping indices is a no-op (AlreadyKnown)", () => {
    const duplicateIndices = [3, 11];
    expect(pool.add(message, attDataRootHex, duplicateIndices)).toBe(InsertOutcome.NewData);
    expect(pool.add(message, attDataRootHex, duplicateIndices)).toBe(InsertOutcome.AlreadyKnown);
  });

  it("aggregates two distinct validators into one PayloadAttestation", () => {
    const indicesA = [1, 4];
    const indicesB = [6];
    expect(pool.add(message, attDataRootHex, indicesA)).toBe(InsertOutcome.NewData);

    const otherSk = SecretKey.fromBytes(Buffer.alloc(32, 7));
    const otherMessage: gloas.PayloadAttestationMessage = {
      data,
      validatorIndex: 99,
      signature: otherSk.sign(ssz.gloas.PayloadAttestationData.hashTreeRoot(data)).toBytes(),
    };
    expect(pool.add(otherMessage, attDataRootHex, indicesB)).toBe(InsertOutcome.Aggregated);

    const [aggregate] = pool.getPayloadAttestationsForBlock(toHexString(beaconBlockRoot), slot);
    expect(aggregate.aggregationBits.getTrueBitIndexes()).toEqual([...indicesA, ...indicesB].sort((a, b) => a - b));
  });

  it("treats a validator at a single position as before (single bit, no extra aggregation)", () => {
    const outcome = pool.add(message, attDataRootHex, [4]);
    expect(outcome).toBe(InsertOutcome.NewData);

    const [aggregate] = pool.getPayloadAttestationsForBlock(toHexString(beaconBlockRoot), slot);
    expect(aggregate.aggregationBits.getTrueBitIndexes()).toEqual([4]);
  });
});
