import {TopicValidatorResult} from "@libp2p/gossipsub";
import {describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {ForkName, GENESIS_EPOCH} from "@lodestar/params";
import {
  ExecutionPayloadEnvelopeError,
  ExecutionPayloadEnvelopeErrorCode,
  ExecutionPayloadEnvelopeErrorType,
  GossipAction,
} from "../../../../src/chain/errors/index.js";
import {GossipHandlers, GossipMessageInfo, GossipType} from "../../../../src/network/gossip/interface.js";
import {PeerAction} from "../../../../src/network/peers/index.js";
import {
  ValidatorFnModules,
  getGossipValidatorFn,
  rejectPeerAction,
} from "../../../../src/network/processor/gossipValidatorFn.js";

describe("gossipValidatorFn execution_payload", () => {
  // The envelope is not signed, an envelope that fails one of these checks is not the one of the block
  const blockBindingErrorCodes = [
    ExecutionPayloadEnvelopeErrorCode.PARENT_BEACON_BLOCK_ROOT_MISMATCH,
    ExecutionPayloadEnvelopeErrorCode.EXECUTION_REQUESTS_ROOT_MISMATCH,
    ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ROOT_MISMATCH,
  ];

  it.each(blockBindingErrorCodes)("%s is Fatal", (code) => {
    expect(rejectPeerAction(GossipType.execution_payload, code)).toBe(PeerAction.Fatal);
  });

  it.each([
    // Cheap checks of payload fields, which the envelope the block commits to can fail as well
    ExecutionPayloadEnvelopeErrorCode.SLOT_MISMATCH,
    ExecutionPayloadEnvelopeErrorCode.BLOCK_HASH_MISMATCH,
    ExecutionPayloadEnvelopeErrorCode.PREV_RANDAO_MISMATCH,
    ExecutionPayloadEnvelopeErrorCode.GAS_LIMIT_MISMATCH,
    ExecutionPayloadEnvelopeErrorCode.PARENT_HASH_MISMATCH,
    ExecutionPayloadEnvelopeErrorCode.INCORRECT_TIMESTAMP,
    ExecutionPayloadEnvelopeErrorCode.WITHDRAWALS_MISMATCH,
  ])("%s of the envelope the block commits to is not Fatal", (code) => {
    expect(rejectPeerAction(GossipType.execution_payload, code)).toBe(PeerAction.LowToleranceError);
  });

  it("reports the peer that sent an envelope with another payload root as Fatal", async () => {
    const reportPeer = vi.fn();
    const onFatalPeer = vi.fn();
    const gossipHandlers = {
      [GossipType.execution_payload]: async () => {
        throw new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
          code: ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ROOT_MISMATCH,
        } as ExecutionPayloadEnvelopeErrorType);
      },
    } as unknown as GossipHandlers;
    const gossipValidatorFn = getGossipValidatorFn(
      gossipHandlers,
      {
        config,
        logger: {debug: vi.fn()},
        metrics: null,
        core: {reportPeer},
      } as unknown as ValidatorFnModules,
      onFatalPeer
    );

    const result = await gossipValidatorFn({
      topic: {type: GossipType.execution_payload, boundary: {fork: ForkName.gloas, epoch: GENESIS_EPOCH}},
      msg: {data: new Uint8Array()},
      propagationSource: "peer",
      seenTimestampSec: 0,
      msgSlot: null,
    } as unknown as GossipMessageInfo);

    expect(result).toBe(TopicValidatorResult.Reject);
    expect(reportPeer).toHaveBeenCalledWith(
      "peer",
      PeerAction.Fatal,
      ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ROOT_MISMATCH
    );
    expect(onFatalPeer).toHaveBeenCalledWith("peer");
  });
});
