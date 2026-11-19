import {beforeEach, describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {IBeaconStateViewGloas, computeTimeAtSlot} from "@lodestar/state-transition";
import {gloas, phase0, ssz} from "@lodestar/types";
import {
  VerifyExecutionPayloadEnvelopeOpts,
  verifyExecutionPayloadEnvelope,
} from "../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js";

/**
 * `verifyExecutionPayloadEnvelope` is the import-time check of an envelope against the post-state of its block.
 * The envelope is not signed: these checks are all that ties it to the block.
 *
 * `importExecutionPayload` skips two of them with `validEnvelope: true`, for an envelope that gossip or API
 * validation already checked against the bid of the block: `verifyPayloadRoot` and `verifyExecutionRequestsRoot`,
 * the two that hash the payload and the execution requests. Every other check runs in any case.
 */
describe("verifyExecutionPayloadEnvelope", () => {
  const config = createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32, 0xaa));
  const genesisTime = 1_000_000;
  const slot = 7;
  const parentRoot = Buffer.alloc(32, 0x77);

  /** What `importExecutionPayload` passes for an envelope that was not validated before, and for one that was */
  const notValidated: VerifyExecutionPayloadEnvelopeOpts = {verifyExecutionRequestsRoot: true, verifyPayloadRoot: true};
  const alreadyValidated: VerifyExecutionPayloadEnvelopeOpts = {
    verifyExecutionRequestsRoot: false,
    verifyPayloadRoot: false,
  };

  let envelope: gloas.ExecutionPayloadEnvelope;
  let bid: gloas.ExecutionPayloadBid;
  let latestBlockHeader: phase0.BeaconBlockHeader;
  let state: IBeaconStateViewGloas;

  beforeEach(() => {
    envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
    envelope.payload.slotNumber = slot;
    envelope.payload.blockHash = Buffer.alloc(32, 0x11);
    envelope.payload.parentHash = Buffer.alloc(32, 0x22);
    envelope.payload.prevRandao = Buffer.alloc(32, 0x33);
    envelope.payload.gasLimit = 30_000_000;
    envelope.payload.timestamp = computeTimeAtSlot(config, slot, genesisTime);
    envelope.payload.withdrawals = [{index: 1, validatorIndex: 2, address: Buffer.alloc(20, 3), amount: 4n}];
    envelope.executionRequests.withdrawals.push(ssz.electra.WithdrawalRequest.defaultValue());
    envelope.parentBeaconBlockRoot = parentRoot;

    // The post-state of the block: the header has no state root yet, the bid is the one of the block
    latestBlockHeader = {
      slot,
      proposerIndex: 0,
      parentRoot,
      stateRoot: Buffer.alloc(32),
      bodyRoot: Buffer.alloc(32, 0xb0),
    };
    const stateRoot = Buffer.alloc(32, 0x55);
    envelope.beaconBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot({...latestBlockHeader, stateRoot});

    bid = ssz.gloas.ExecutionPayloadBid.defaultValue();
    bid.slot = slot;
    bid.parentBlockRoot = parentRoot;
    bid.parentBlockHash = envelope.payload.parentHash;
    bid.blockHash = envelope.payload.blockHash;
    bid.prevRandao = envelope.payload.prevRandao;
    bid.gasLimit = BigInt(envelope.payload.gasLimit);
    bid.payloadRoot = ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload);
    bid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(envelope.executionRequests);

    state = {
      latestBlockHeader,
      hashTreeRoot: () => stateRoot,
      latestExecutionPayloadBid: bid,
      latestBlockHash: envelope.payload.parentHash,
      genesisTime,
      payloadExpectedWithdrawals: envelope.payload.withdrawals,
    } as unknown as IBeaconStateViewGloas;
  });

  it.each([
    {name: "default options", opts: undefined},
    {name: "not validated before", opts: notValidated},
    {name: "already validated", opts: alreadyValidated},
  ])("accepts the envelope of the block, $name", ({opts}) => {
    expect(() => verifyExecutionPayloadEnvelope(config, state, envelope, opts)).not.toThrow();
  });

  describe("checks skipped for an already validated envelope", () => {
    it("payload root: another payload with the block hash, slot and requests the bid commits to", () => {
      envelope.payload.gasUsed += 1;

      expect(() => verifyExecutionPayloadEnvelope(config, state, envelope)).toThrow("Payload root mismatch");
      expect(() => verifyExecutionPayloadEnvelope(config, state, envelope, notValidated)).toThrow(
        "Payload root mismatch"
      );
      // Skipped: gossip and API validation check `hash_tree_root(payload) == bid.payload_root`
      expect(() => verifyExecutionPayloadEnvelope(config, state, envelope, alreadyValidated)).not.toThrow();
    });

    it("execution requests root: other requests than the bid commits to", () => {
      envelope.executionRequests.withdrawals.push(ssz.electra.WithdrawalRequest.defaultValue());

      expect(() => verifyExecutionPayloadEnvelope(config, state, envelope)).toThrow("Execution requests root mismatch");
      expect(() => verifyExecutionPayloadEnvelope(config, state, envelope, notValidated)).toThrow(
        "Execution requests root mismatch"
      );
      // Skipped: gossip and API validation check
      // `hash_tree_root(envelope.execution_requests) == bid.execution_requests_root`
      expect(() => verifyExecutionPayloadEnvelope(config, state, envelope, alreadyValidated)).not.toThrow();
    });

    it("each of the two is skipped on its own", () => {
      envelope.payload.gasUsed += 1;
      envelope.executionRequests.withdrawals.push(ssz.electra.WithdrawalRequest.defaultValue());

      expect(() =>
        verifyExecutionPayloadEnvelope(config, state, envelope, {...alreadyValidated, verifyPayloadRoot: true})
      ).toThrow("Payload root mismatch");
      expect(() =>
        verifyExecutionPayloadEnvelope(config, state, envelope, {
          ...alreadyValidated,
          verifyExecutionRequestsRoot: true,
        })
      ).toThrow("Execution requests root mismatch");
    });
  });

  describe("checks made in any case", () => {
    /** Makes the bid commit to the payload as modified by the test, so that only the check under test fails */
    function commitBid(): void {
      bid.payloadRoot = ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload);
    }

    function expectThrowWithAndWithoutFlag(message: string): void {
      expect(() => verifyExecutionPayloadEnvelope(config, state, envelope, notValidated)).toThrow(message);
      expect(() => verifyExecutionPayloadEnvelope(config, state, envelope, alreadyValidated)).toThrow(message);
    }

    it("parent beacon block root", () => {
      envelope.parentBeaconBlockRoot = Buffer.alloc(32, 0x88);
      expectThrowWithAndWithoutFlag("Envelope's parent_beacon_block_root mismatch");
    });

    it("beacon block root", () => {
      envelope.beaconBlockRoot = Buffer.alloc(32, 0x99);
      expectThrowWithAndWithoutFlag("Envelope's block is not the latest block header");
    });

    it("block hash", () => {
      envelope.payload.blockHash = Buffer.alloc(32, 0x12);
      commitBid();
      expectThrowWithAndWithoutFlag("Block hash mismatch");
    });

    it("prev randao", () => {
      envelope.payload.prevRandao = Buffer.alloc(32, 0x34);
      commitBid();
      expectThrowWithAndWithoutFlag("Prev randao mismatch");
    });

    it("gas limit", () => {
      envelope.payload.gasLimit += 1;
      commitBid();
      expectThrowWithAndWithoutFlag("Gas limit mismatch");
    });

    it("slot", () => {
      envelope.payload.slotNumber = slot + 1;
      commitBid();
      expectThrowWithAndWithoutFlag("Slot mismatch");
    });

    it("parent hash", () => {
      envelope.payload.parentHash = Buffer.alloc(32, 0x23);
      commitBid();
      expectThrowWithAndWithoutFlag("Parent hash mismatch");
    });

    it("timestamp", () => {
      envelope.payload.timestamp += 1;
      commitBid();
      expectThrowWithAndWithoutFlag("Timestamp mismatch");
    });

    it("withdrawals", () => {
      envelope.payload.withdrawals = [];
      commitBid();
      expectThrowWithAndWithoutFlag("Withdrawals mismatch");
    });
  });
});
