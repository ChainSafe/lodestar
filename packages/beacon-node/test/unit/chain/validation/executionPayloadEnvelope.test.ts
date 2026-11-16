import {beforeEach, describe, expect, it, vi} from "vitest";
import {SerializedList} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {PayloadStatus} from "@lodestar/fork-choice";
import {
  ForkName,
  MAX_BUILDER_DEPOSIT_REQUESTS_PER_PAYLOAD,
  MAX_BUILDER_EXIT_REQUESTS_PER_PAYLOAD,
  MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD,
  MAX_WITHDRAWALS_PER_PAYLOAD,
  MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD,
} from "@lodestar/params";
import {IBeaconStateView, computeTimeAtSlot} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {
  ExecutionPayloadEnvelopeError,
  ExecutionPayloadEnvelopeErrorCode,
  GossipAction,
} from "../../../../src/chain/errors/index.js";
import {validateGossipExecutionPayloadEnvelope} from "../../../../src/chain/validation/executionPayloadEnvelope.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("validateGossipExecutionPayloadEnvelope", () => {
  const config = createChainForkConfig({
    ...configDef,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 0,
  });
  const slot = 5;
  const parentRoot = Buffer.alloc(32, 0x77);

  let chain: MockedBeaconChain;
  /** The envelope the block's bid commits to */
  let envelope: gloas.ExecutionPayloadEnvelope;
  let bid: gloas.ExecutionPayloadBid;
  let blockRootHex: string;
  let payloadInput: PayloadEnvelopeInput;

  beforeEach(() => {
    envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
    envelope.payload.slotNumber = slot;
    envelope.payload.blockHash = Buffer.alloc(32, 0x11);
    envelope.payload.parentHash = Buffer.alloc(32, 0x22);
    envelope.payload.prevRandao = Buffer.alloc(32, 0x33);
    envelope.payload.gasLimit = 30_000_000;
    envelope.payload.timestamp = computeTimeAtSlot(config, slot, 0);
    envelope.executionRequests.withdrawals.push(ssz.electra.WithdrawalRequest.defaultValue());
    envelope.parentBeaconBlockRoot = parentRoot;

    // The envelope is not signed, it is tied to the block only through the commitments of the block's bid
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.parentRoot = parentRoot;
    bid = block.message.body.signedExecutionPayloadBid.message;
    bid.gasLimit = BigInt(envelope.payload.gasLimit);
    bid.prevRandao = envelope.payload.prevRandao;
    bid.parentBlockHash = envelope.payload.parentHash;
    bid.blockHash = envelope.payload.blockHash;
    bid.payloadRoot = ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload);
    bid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(envelope.executionRequests);
    const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
    blockRootHex = toRootHex(blockRoot);
    envelope.beaconBlockRoot = blockRoot;

    payloadInput = PayloadEnvelopeInput.createFromBlock({
      block,
      blockRootHex,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      daOutOfRange: false,
      source: PayloadEnvelopeInputSource.gossip,
      seenTimestampSec: 0,
    });

    chain = getMockedBeaconChain({config, genesisTime: 0});
    chain.forkChoice.getBlockDefaultStatus.mockReturnValue(
      generateProtoBlock({
        slot,
        blockRoot: blockRootHex,
        parentRoot: toRootHex(parentRoot),
        executionPayloadGasLimit: 0,
        payloadRoot: toRootHex(bid.payloadRoot),
      })
    );
    // the FULL variant is not in fork choice, the payload is not imported yet
    chain.forkChoice.getBlockHex.mockReturnValue(null);
    chain.forkChoice.getFinalizedCheckpoint.mockReturnValue({epoch: 0, root: Buffer.alloc(32), rootHex: ""});
    vi.mocked(chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(payloadInput);
  });

  it("accepts the envelope the block's bid commits to", async () => {
    await expect(validateGossipExecutionPayloadEnvelope(chain, envelope)).resolves.toBeUndefined();

    expect(chain.forkChoice.getBlockHex).toHaveBeenCalledWith(blockRootHex, PayloadStatus.FULL);
    // the envelope is not signed, nothing to verify with BLS and no state is needed
    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
    expect(chain.regen.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("ignores an envelope whose block root is unknown", async () => {
    chain.forkChoice.getBlockDefaultStatus.mockReturnValue(null);

    await expectRejectedWithLodestarError(
      validateGossipExecutionPayloadEnvelope(chain, envelope),
      new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
        code: ExecutionPayloadEnvelopeErrorCode.BLOCK_ROOT_UNKNOWN,
        blockRoot: blockRootHex,
      })
    );
  });

  it.each([
    {name: "the payload is imported in fork choice", imported: true},
    {name: "the seen cache already holds an envelope for the block", imported: false},
  ])("ignores an envelope if $name", async ({imported}) => {
    if (imported) {
      chain.forkChoice.getBlockHex.mockReturnValue(
        generateProtoBlock({slot, blockRoot: blockRootHex, payloadStatus: PayloadStatus.FULL})
      );
    } else {
      payloadInput.addPayloadEnvelope({
        envelope: ssz.gloas.ExecutionPayloadEnvelope.clone(envelope),
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: 0,
      });
    }

    const promise = validateGossipExecutionPayloadEnvelope(chain, envelope);
    await expectRejectedWithLodestarError(
      promise,
      new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
        code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
        blockRoot: blockRootHex,
        slot,
      })
    );
    await expect(promise).rejects.toHaveProperty("action", GossipAction.IGNORE);
  });

  it("rejects an envelope whose parent beacon block root is not the block's parent root", async () => {
    const wrongParentRoot = Buffer.alloc(32, 0x88);
    envelope.parentBeaconBlockRoot = wrongParentRoot;

    const promise = validateGossipExecutionPayloadEnvelope(chain, envelope);
    await expectRejectedWithLodestarError(
      promise,
      new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
        code: ExecutionPayloadEnvelopeErrorCode.PARENT_BEACON_BLOCK_ROOT_MISMATCH,
        slot,
        root: blockRootHex,
        envelopeParentRoot: toRootHex(wrongParentRoot),
        blockParentRoot: toRootHex(parentRoot),
      })
    );
    await expect(promise).rejects.toHaveProperty("action", GossipAction.REJECT);
  });

  it("rejects an envelope whose payload root is not the one the bid commits to", async () => {
    const bidPayloadRoot = ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload);
    // same block hash, slot and requests, another payload
    envelope.payload.gasUsed += 1;

    const promise = validateGossipExecutionPayloadEnvelope(chain, envelope);
    await expectRejectedWithLodestarError(
      promise,
      new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
        code: ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ROOT_MISMATCH,
        slot,
        root: blockRootHex,
        envelopePayloadRoot: toRootHex(ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload)),
        bidPayloadRoot: toRootHex(bidPayloadRoot),
      })
    );
    await expect(promise).rejects.toHaveProperty("action", GossipAction.REJECT);
  });
  describe("an envelope the bid commits to that is not valid for the block", () => {
    /** Makes the bid commit to the envelope as modified by the test, the checks that bind it to the block pass */
    function commitBid(): void {
      bid.payloadRoot = ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload);
      bid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(envelope.executionRequests);
    }

    async function expectReject(type: ExecutionPayloadEnvelopeError["type"]): Promise<void> {
      const promise = validateGossipExecutionPayloadEnvelope(chain, envelope);
      await expectRejectedWithLodestarError(promise, new ExecutionPayloadEnvelopeError(GossipAction.REJECT, type));
      await expect(promise).rejects.toHaveProperty("action", GossipAction.REJECT);
    }

    it("rejects a payload whose prev randao is not the bid's", async () => {
      bid.prevRandao = Buffer.alloc(32, 0x44);
      await expectReject({
        code: ExecutionPayloadEnvelopeErrorCode.PREV_RANDAO_MISMATCH,
        slot,
        root: blockRootHex,
        actual: toRootHex(envelope.payload.prevRandao),
        expected: toRootHex(bid.prevRandao),
      });
    });

    it("rejects a payload whose gas limit is not the bid's", async () => {
      bid.gasLimit = 36_000_000n;
      await expectReject({
        code: ExecutionPayloadEnvelopeErrorCode.GAS_LIMIT_MISMATCH,
        slot,
        root: blockRootHex,
        actual: 30_000_000,
        expected: 36_000_000,
      });
    });

    it.each([
      {
        requestType: "withdrawals" as const,
        limit: MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD,
        request: ssz.electra.WithdrawalRequest.defaultValue(),
      },
      {
        requestType: "consolidations" as const,
        limit: MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD,
        request: ssz.electra.ConsolidationRequest.defaultValue(),
      },
      {
        requestType: "builderDeposits" as const,
        limit: MAX_BUILDER_DEPOSIT_REQUESTS_PER_PAYLOAD,
        request: ssz.gloas.BuilderDepositRequest.defaultValue(),
      },
      {
        requestType: "builderExits" as const,
        limit: MAX_BUILDER_EXIT_REQUESTS_PER_PAYLOAD,
        request: ssz.gloas.BuilderExitRequest.defaultValue(),
      },
    ])("rejects execution requests with more $requestType than the limit", async ({requestType, limit, request}) => {
      (envelope.executionRequests[requestType] as unknown[]) = Array.from({length: limit + 1}, () => request);
      commitBid();
      await expectReject({
        code: ExecutionPayloadEnvelopeErrorCode.TOO_MANY_EXECUTION_REQUESTS,
        slot,
        root: blockRootHex,
        requestType,
        count: limit + 1,
        limit,
      });
    });

    it("rejects a payload with more withdrawals than the limit", async () => {
      envelope.payload.withdrawals = Array.from({length: MAX_WITHDRAWALS_PER_PAYLOAD + 1}, () =>
        ssz.capella.Withdrawal.defaultValue()
      );
      commitBid();
      await expectReject({
        code: ExecutionPayloadEnvelopeErrorCode.TOO_MANY_WITHDRAWALS,
        slot,
        root: blockRootHex,
        count: MAX_WITHDRAWALS_PER_PAYLOAD + 1,
        limit: MAX_WITHDRAWALS_PER_PAYLOAD,
      });
    });

    it("rejects a payload that does not build on the parent block hash of the bid", async () => {
      bid.parentBlockHash = Buffer.alloc(32, 0x55);
      await expectReject({
        code: ExecutionPayloadEnvelopeErrorCode.PARENT_HASH_MISMATCH,
        slot,
        root: blockRootHex,
        actual: toRootHex(envelope.payload.parentHash),
        expected: toRootHex(bid.parentBlockHash),
      });
    });

    it("rejects a payload whose timestamp is not the time of the block's slot", async () => {
      const expected = envelope.payload.timestamp;
      envelope.payload.timestamp += 1;
      commitBid();
      await expectReject({
        code: ExecutionPayloadEnvelopeErrorCode.INCORRECT_TIMESTAMP,
        slot,
        root: blockRootHex,
        actual: expected + 1,
        expected,
      });
    });

    it("rejects a payload with an empty transaction", async () => {
      envelope.payload.transactions = SerializedList.fromArray([new Uint8Array([1]), new Uint8Array(0)]);
      commitBid();
      await expectReject({
        code: ExecutionPayloadEnvelopeErrorCode.EMPTY_TRANSACTION,
        slot,
        root: blockRootHex,
        index: 1,
      });
    });

    describe("withdrawals expected by the block's post-state", () => {
      const expectedWithdrawals = [{...ssz.capella.Withdrawal.defaultValue(), amount: 1n}];

      beforeEach(() => {
        // the post-state of a block that was just imported is in the state cache
        chain.regen.getStateSync.mockReturnValue({
          forkName: ForkName.gloas,
          payloadExpectedWithdrawals: expectedWithdrawals,
        } as unknown as IBeaconStateView);
      });

      it("rejects a payload whose withdrawals are not the expected ones", async () => {
        await expectReject({
          code: ExecutionPayloadEnvelopeErrorCode.WITHDRAWALS_MISMATCH,
          slot,
          root: blockRootHex,
          actual: toRootHex(ssz.gloas.Withdrawals.hashTreeRoot([])),
          expected: toRootHex(ssz.gloas.Withdrawals.hashTreeRoot(expectedWithdrawals)),
        });
      });

      it("accepts a payload with the expected withdrawals, without regenerating a state", async () => {
        envelope.payload.withdrawals = expectedWithdrawals;
        commitBid();
        await expect(validateGossipExecutionPayloadEnvelope(chain, envelope)).resolves.toBeUndefined();
        expect(chain.regen.getState).not.toHaveBeenCalled();
      });
    });

    it("fails the check that binds the envelope to the block for an envelope that is also not valid", async () => {
      const bidPayloadRoot = bid.payloadRoot;
      // not the payload of the bid, and its timestamp is wrong
      envelope.payload.timestamp += 1;
      await expectReject({
        code: ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ROOT_MISMATCH,
        slot,
        root: blockRootHex,
        envelopePayloadRoot: toRootHex(ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload)),
        bidPayloadRoot: toRootHex(bidPayloadRoot),
      });
    });
  });
});
