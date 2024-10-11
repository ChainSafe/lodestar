import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
// We need to import the mock before the packages
import {MockedBeaconChain, getMockedBeaconChain} from "../../../../mocks/mockedBeaconChain.js";
import {EpochShuffling, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {EpochDifference, ProtoBlock} from "@lodestar/fork-choice";
import {RegenCaller} from "../../../../../src/chain/regen/interface.js";
import {getShufflingForAttestationVerification} from "../../../../../src/chain/validation/index.js";
import {ZERO_HASH_HEX} from "../../../../../src/constants/constants.js";

describe("getShufflingForAttestationVerification", () => {
  let chain: MockedBeaconChain;
  let regenStub: MockedBeaconChain["regen"];
  let forkchoiceStub: MockedBeaconChain["forkChoice"];
  let shufflingCacheStub: MockedBeaconChain["shufflingCache"];

  beforeEach(() => {
    chain = getMockedBeaconChain();
    regenStub = chain.regen;
    forkchoiceStub = chain.forkChoice;
    shufflingCacheStub = chain.shufflingCache;
    vi.spyOn(regenStub, "getBlockSlotState");
    vi.spyOn(regenStub, "getState");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const attEpoch = 1000;
  const blockRoot = "0xd76aed834b4feef32efb53f9076e407c0d344cfdb70f0a770fa88416f70d304d";

  it("block epoch is the same to attestation epoch", async () => {
    const headSlot = computeStartSlotAtEpoch(attEpoch);
    const attHeadBlock = {
      slot: headSlot,
      stateRoot: ZERO_HASH_HEX,
      blockRoot,
    } as Partial<ProtoBlock>;
    const previousDependentRoot = "0xa916b57729dbfb89a082820e0eb2b669d9d511a675d3d8c888b2f300f10b0bdf";
    forkchoiceStub.getDependentRoot.mockImplementationOnce((block, epochDiff) => {
      if (block === attHeadBlock && epochDiff === EpochDifference.previous) {
        return previousDependentRoot;
      } else {
        throw new Error("Unexpected input");
      }
    });
    const expectedShuffling = {epoch: attEpoch} as EpochShuffling;
    shufflingCacheStub.get.mockImplementationOnce((epoch, root) => {
      if (epoch === attEpoch && root === previousDependentRoot) {
        return Promise.resolve(expectedShuffling);
      } else {
        return Promise.resolve(null);
      }
    });
    const resultShuffling = await getShufflingForAttestationVerification(
      chain,
      attEpoch,
      attHeadBlock as ProtoBlock,
      RegenCaller.validateGossipAttestation
    );
    expect(resultShuffling).toEqual(expectedShuffling);
  });

  it("block epoch is previous attestation epoch", async () => {
    const headSlot = computeStartSlotAtEpoch(attEpoch - 1);
    const attHeadBlock = {
      slot: headSlot,
      stateRoot: ZERO_HASH_HEX,
      blockRoot,
    } as Partial<ProtoBlock>;
    const currentDependentRoot = "0xa916b57729dbfb89a082820e0eb2b669d9d511a675d3d8c888b2f300f10b0bdf";
    forkchoiceStub.getDependentRoot.mockImplementationOnce((block, epochDiff) => {
      if (block === attHeadBlock && epochDiff === EpochDifference.current) {
        return currentDependentRoot;
      } else {
        throw new Error("Unexpected input");
      }
    });
    const expectedShuffling = {epoch: attEpoch} as EpochShuffling;
    shufflingCacheStub.get.mockImplementationOnce((epoch, root) => {
      if (epoch === attEpoch && root === currentDependentRoot) {
        return Promise.resolve(expectedShuffling);
      } else {
        return Promise.resolve(null);
      }
    });
    const resultShuffling = await getShufflingForAttestationVerification(
      chain,
      attEpoch,
      attHeadBlock as ProtoBlock,
      RegenCaller.validateGossipAttestation
    );
    expect(resultShuffling).toEqual(expectedShuffling);
  });

  it("block epoch is attestation epoch - 2", async () => {
    const headSlot = computeStartSlotAtEpoch(attEpoch - 2);
    const attHeadBlock = {
      slot: headSlot,
      stateRoot: ZERO_HASH_HEX,
      blockRoot,
    } as Partial<ProtoBlock>;
    const expectedShuffling = {epoch: attEpoch} as EpochShuffling;
    let callCount = 0;
    shufflingCacheStub.get.mockImplementationOnce((epoch, root) => {
      if (epoch === attEpoch && root === blockRoot) {
        if (callCount === 0) {
          callCount++;
          return Promise.resolve(null);
        } else {
          return Promise.resolve(expectedShuffling);
        }
      } else {
        return Promise.resolve(null);
      }
    });
    chain.regenStateForAttestationVerification.mockImplementationOnce(() => Promise.resolve(expectedShuffling));

    const resultShuffling = await getShufflingForAttestationVerification(
      chain,
      attEpoch,
      attHeadBlock as ProtoBlock,
      RegenCaller.validateGossipAttestation
    );
    // sandbox.assert.notCalled(forkchoiceStub.getDependentRoot);
    expect(forkchoiceStub.getDependentRoot).not.toHaveBeenCalledTimes(1);
    expect(resultShuffling).toEqual(expectedShuffling);
  });

  it("block epoch is attestation epoch + 1", async () => {
    const headSlot = computeStartSlotAtEpoch(attEpoch + 1);
    const attHeadBlock = {
      slot: headSlot,
      stateRoot: ZERO_HASH_HEX,
      blockRoot,
    } as Partial<ProtoBlock>;
    try {
      await getShufflingForAttestationVerification(
        chain,
        attEpoch,
        attHeadBlock as ProtoBlock,
        RegenCaller.validateGossipAttestation
      );
      expect.fail("Expect error because attestation epoch is greater than block epoch");
    } catch (e) {
      expect(e instanceof Error).toBeTruthy();
    }
  });
});
