import {describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {BeaconStateView, createCachedBeaconState, isStatePostFulu} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {
  BlockType,
  getPayloadAttributesForSSE,
  produceBlockBody,
  produceCommonBlockBody,
} from "../../../../src/chain/produceBlock/produceBlockBody.js";
import {PayloadIdCache} from "../../../../src/execution/index.js";
import {getApiTestModules} from "../../../utils/api.js";
import {generateState} from "../../../utils/state.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

function setup(fork: ForkName.fulu | ForkName.gloas | ForkName.heze = ForkName.fulu) {
  const slot = 2;
  const config = createBeaconConfig(getConfig(fork), new Uint8Array(32));
  const state = new BeaconStateView(
    createCachedBeaconState(generateState({slot}, config, true), {config, pubkeyCache})
  );
  const modules = getApiTestModules({config});
  if (!isStatePostFulu(state)) throw new Error("Expected supported proposal state");
  const chain = modules.chain as unknown as BeaconChain;
  const parentBlockRoot = new Uint8Array(32).fill(1);
  const parentBlock = generateProtoBlock({slot: slot - 1, blockRoot: toRootHex(parentBlockRoot)});
  const attrs = {
    slot,
    parentBlock,
    randaoReveal: new Uint8Array(96).fill(2),
    graffiti: new Uint8Array(32).fill(3),
  };
  const {
    executionPayload: _executionPayload,
    blobKzgCommitments: _blobKzgCommitments,
    executionRequests: _executionRequests,
    ...common
  } = ssz.fulu.BeaconBlockBody.defaultValue();
  common.blsToExecutionChanges = [ssz.capella.SignedBLSToExecutionChange.defaultValue()];
  common.syncAggregate.syncCommitteeBits.set(1, true);
  modules.chain.opPool.getSlashingsAndExits.mockReturnValue([
    common.attesterSlashings,
    common.proposerSlashings,
    common.voluntaryExits,
    common.blsToExecutionChanges,
  ]);
  modules.chain.aggregatedAttestationPool.getAttestationsForBlock.mockReturnValue(common.attestations);
  modules.chain.syncContributionAndProofPool.getAggregate.mockReturnValue(common.syncAggregate);
  modules.forkChoice.getConfirmedBlock.mockReturnValue(parentBlock);
  modules.forkChoice.getFinalizedBlock.mockReturnValue(parentBlock);
  return {slot, config, state, modules, chain, attrs, common, parentBlockRoot};
}

describe("supported proposal body fields", () => {
  for (const fork of [ForkName.fulu, ForkName.gloas, ForkName.heze] as const) {
    for (const blockType of [BlockType.Full, BlockType.Blinded]) {
      it(`${fork} ${blockType} includes selected operations and the parent sync aggregate`, async () => {
        const {state, modules, chain, attrs, common, parentBlockRoot} = setup(fork);
        const body = await produceCommonBlockBody.call(chain, blockType, state, attrs);
        expect(body).toEqual({
          randaoReveal: attrs.randaoReveal,
          graffiti: attrs.graffiti,
          eth1Data: state.eth1Data,
          proposerSlashings: common.proposerSlashings,
          attesterSlashings: common.attesterSlashings,
          attestations: common.attestations,
          deposits: [],
          voluntaryExits: common.voluntaryExits,
          blsToExecutionChanges: common.blsToExecutionChanges,
          syncAggregate: common.syncAggregate,
        });
        expect(modules.chain.syncContributionAndProofPool.getAggregate).toHaveBeenCalledExactlyOnceWith(
          attrs.slot - 1,
          parentBlockRoot
        );
      });
    }
  }
});

describe("Fulu builder body", () => {
  function setupBuilder() {
    const context = setup();
    const response = {
      header: ssz.fulu.ExecutionPayloadHeader.defaultValue(),
      executionPayloadValue: 123n,
      blobKzgCommitments: [new Uint8Array(48).fill(4)],
      executionRequests: ssz.electra.ExecutionRequests.defaultValue(),
    };
    response.executionRequests.deposits.push(ssz.electra.DepositRequest.defaultValue());
    context.modules.chain.executionBuilder.getHeader = vi.fn().mockResolvedValue(response);
    context.modules.chain.executionBuilder.getValidatorRegistration = vi.fn();
    const produce = () =>
      produceBlockBody.call(context.chain, BlockType.Blinded, context.state, {
        ...context.attrs,
        proposerIndex: 0,
        proposerPubKey: new Uint8Array(48),
        commonBlockBodyPromise: Promise.resolve(context.common),
      });
    return {...context, response, produce};
  }

  it("copies required builder fields without mutating the shared common body", async () => {
    const {response, produce, common} = setupBuilder();
    const before = structuredClone(common);
    const result = await produce();
    expect(result.body).toEqual({
      ...common,
      executionPayloadHeader: response.header,
      blobKzgCommitments: response.blobKzgCommitments,
      executionRequests: response.executionRequests,
    });
    expect(result.executionPayloadValue).toBe(response.executionPayloadValue);
    expect(common).toEqual(before);
  });

  for (const field of ["blobKzgCommitments", "executionRequests"] as const) {
    it(`rejects a builder response missing ${field}`, async () => {
      const {modules, response, produce} = setupBuilder();
      modules.chain.executionBuilder.getHeader.mockResolvedValue({...response, [field]: undefined});
      await expect(produce()).rejects.toThrow(`missing ${field}`);
    });
  }
});

describe("Fulu engine body", () => {
  for (const requested of [true, false]) {
    it(`uses the ${requested ? "requested" : "cached"} fee recipient for payload preparation`, async () => {
      const {state, modules, chain, attrs, common, parentBlockRoot} = setup();
      const requestedRecipient = "0xccccccccccccccccccccccccccccccccccccccaa";
      const cachedRecipient = "0xccccccccccccccccccccccccccccccccccccccbb";
      modules.chain.beaconProposerCache.getOrDefault.mockReturnValue(cachedRecipient);
      modules.chain.executionEngine.payloadIdCache = new PayloadIdCache();
      modules.chain.executionEngine.notifyForkchoiceUpdate.mockResolvedValue("0x1234");
      modules.chain.executionEngine.getPayload.mockResolvedValue({
        executionPayload: ssz.fulu.ExecutionPayload.defaultValue(),
        executionPayloadValue: 456n,
        blobsBundle: ssz.fulu.BlobsBundle.defaultValue(),
        executionRequests: ssz.electra.ExecutionRequests.defaultValue(),
      });
      const result = await produceBlockBody.call(chain, BlockType.Full, state, {
        ...attrs,
        feeRecipient: requested ? requestedRecipient : undefined,
        proposerIndex: 0,
        proposerPubKey: new Uint8Array(48),
        commonBlockBodyPromise: Promise.resolve(common),
      });
      expect(modules.chain.executionEngine.notifyForkchoiceUpdate).toHaveBeenCalledExactlyOnceWith(
        ForkName.fulu,
        toRootHex(state.latestExecutionPayloadHeader.blockHash),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          suggestedFeeRecipient: requested ? requestedRecipient : cachedRecipient,
          withdrawals: [],
          parentBeaconBlockRoot: parentBlockRoot,
        })
      );
      expect(result.executionPayloadValue).toBe(456n);
      expect(result.produceResult).toMatchObject({fork: ForkName.fulu, type: BlockType.Full, cells: []});
    });
  }
});

describe("supported payload attributes", () => {
  it("rejects an unapplied full Gloas parent before preparing withdrawals", () => {
    const {state, chain, slot, parentBlockRoot} = setup(ForkName.gloas);
    const parentBlockHash = new Uint8Array(32).fill(5);
    vi.spyOn(state, "latestExecutionPayloadBid", "get").mockReturnValue({
      ...ssz.gloas.ExecutionPayloadBid.defaultValue(),
      blockHash: parentBlockHash,
    });
    vi.spyOn(state, "latestBlockHash", "get").mockReturnValue(new Uint8Array(32).fill(6));
    const withdrawalSpy = vi.spyOn(state, "getExpectedWithdrawals");
    expect(() =>
      getPayloadAttributesForSSE(ForkName.gloas, chain, {
        prepareState: state,
        prepareSlot: slot,
        parentBlockRoot,
        parentBlockHash,
        feeRecipient: "0xccccccccccccccccccccccccccccccccccccccaa",
      })
    ).toThrow("Expected state with parent execution payload applied for withdrawals");
    expect(withdrawalSpy).not.toHaveBeenCalled();
  });
  for (const fork of [ForkName.fulu, ForkName.gloas, ForkName.heze] as const) {
    for (const fullParent of fork === ForkName.fulu ? [true] : [true, false]) {
      it(`${fork} builds on a ${fullParent ? "full" : "empty"} parent with the correct withdrawals`, () => {
        const {state, chain, modules, slot, parentBlockRoot} = setup(fork);
        const parentBlockHash = new Uint8Array(32).fill(fullParent ? 5 : 6);
        const computed = [{...ssz.capella.Withdrawal.defaultValue(), amount: 7n}];
        const carried = [{...ssz.capella.Withdrawal.defaultValue(), amount: 8n}];
        const withdrawalSpy = vi.spyOn(state, "getExpectedWithdrawals").mockReturnValue({
          expectedWithdrawals: computed,
          processedBuilderWithdrawalsCount: 0,
          processedPartialWithdrawalsCount: 0,
          processedBuildersSweepCount: 0,
          processedValidatorSweepCount: 0,
        });
        if (fork !== ForkName.fulu) {
          vi.spyOn(state, "latestExecutionPayloadBid", "get").mockReturnValue({
            ...ssz.gloas.ExecutionPayloadBid.defaultValue(),
            blockHash: new Uint8Array(32).fill(5),
          });
          vi.spyOn(state, "latestBlockHash", "get").mockReturnValue(new Uint8Array(32).fill(5));
          vi.spyOn(state, "payloadExpectedWithdrawals", "get").mockReturnValue(carried);
          modules.forkChoice.getBlockHexDefaultStatus.mockReturnValue(null);
          modules.forkChoice.getBlockHexAndBlockHash.mockReturnValue(
            generateProtoBlock({
              executionPayloadBlockHash: toRootHex(parentBlockHash),
              executionPayloadGasLimit: 30_000_000,
            })
          );
        }
        vi.spyOn(state, "getBeaconProposer").mockReturnValue(0);
        const result = getPayloadAttributesForSSE(fork, chain, {
          prepareState: state,
          prepareSlot: slot,
          parentBlockRoot,
          parentBlockHash,
          feeRecipient: "0xccccccccccccccccccccccccccccccccccccccaa",
        });
        expect(result.payloadAttributes).toMatchObject({
          withdrawals: fullParent ? computed : carried,
          parentBeaconBlockRoot: parentBlockRoot,
          suggestedFeeRecipient: "0xccccccccccccccccccccccccccccccccccccccaa",
        });
        expect(withdrawalSpy).toHaveBeenCalledTimes(fullParent ? 1 : 0);
        if (fork !== ForkName.fulu) {
          expect(result.payloadAttributes).toMatchObject({slotNumber: slot, targetGasLimit: 30_000_000n});
          expect(result).not.toHaveProperty("parentBlockNumber");
        } else {
          expect(result).toHaveProperty("parentBlockNumber", state.payloadBlockNumber);
          expect(result.payloadAttributes).not.toHaveProperty("slotNumber");
        }
        if (fork === ForkName.heze) expect(result.payloadAttributes).toHaveProperty("inclusionListTransactions", []);
      });
    }
  }
});
