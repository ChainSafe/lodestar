import {TopicValidatorResult} from "@libp2p/gossipsub";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {AttestationError, AttestationErrorCode} from "../../../../src/chain/errors/attestationError.js";
import {BlockErrorCode, BlockGossipError} from "../../../../src/chain/errors/blockError.js";
import {GossipAction} from "../../../../src/chain/errors/gossipValidation.js";
import {INetworkCore} from "../../../../src/network/core/index.js";
import {GossipHandlers, GossipMessageInfo, GossipTopic, GossipType} from "../../../../src/network/gossip/interface.js";
import {PeerAction} from "../../../../src/network/peers/index.js";
import {
  ValidatorFnModules,
  getGossipValidatorBatchFn,
  getGossipValidatorFn,
} from "../../../../src/network/processor/gossipValidatorFn.js";

describe("gossipValidatorFn", () => {
  const logger = testLogger();
  const peerIdStr = "16Uiu2HAmFakePeerIdForGossipValidatorFnTest";

  let core: INetworkCore;
  let modules: ValidatorFnModules;

  beforeEach(() => {
    core = {reportPeer: vi.fn()} as unknown as INetworkCore;
    modules = {config, logger, metrics: null, core};
  });

  function getMessageInfo(type: GossipType): GossipMessageInfo {
    return {
      topic: {type} as GossipTopic,
      msg: {data: new Uint8Array()} as GossipMessageInfo["msg"],
      propagationSource: peerIdStr,
      clientAgent: "Unknown",
      clientVersion: "",
      seenTimestampSec: Date.now() / 1000,
      msgSlot: null,
    };
  }

  function getHandlers(type: GossipType, handler: () => Promise<void>): GossipHandlers {
    return {[type]: handler} as unknown as GossipHandlers;
  }

  const rejectError = new BlockGossipError(GossipAction.REJECT, {
    code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
    slot: 100,
    root: "0x1234",
  });

  const ignoreError = new BlockGossipError(GossipAction.IGNORE, {
    code: BlockErrorCode.ALREADY_KNOWN,
    root: "0x1234",
  });

  it("reports peer with LowToleranceError on beacon_block REJECT", async () => {
    const validatorFn = getGossipValidatorFn(
      getHandlers(GossipType.beacon_block, () => Promise.reject(rejectError)),
      modules
    );

    const result = await validatorFn(getMessageInfo(GossipType.beacon_block));

    expect(result).toBe(TopicValidatorResult.Reject);
    expect(core.reportPeer).toHaveBeenCalledOnce();
    expect(core.reportPeer).toHaveBeenCalledWith(
      peerIdStr,
      PeerAction.LowToleranceError,
      BlockErrorCode.PROPOSAL_SIGNATURE_INVALID
    );
  });

  it("reports peer with MidToleranceError on non-critical topic REJECT", async () => {
    const validatorFn = getGossipValidatorFn(
      getHandlers(GossipType.beacon_aggregate_and_proof, () => Promise.reject(rejectError)),
      modules
    );

    const result = await validatorFn(getMessageInfo(GossipType.beacon_aggregate_and_proof));

    expect(result).toBe(TopicValidatorResult.Reject);
    expect(core.reportPeer).toHaveBeenCalledOnce();
    expect(core.reportPeer).toHaveBeenCalledWith(
      peerIdStr,
      PeerAction.MidToleranceError,
      BlockErrorCode.PROPOSAL_SIGNATURE_INVALID
    );
  });

  it("does not report peer on IGNORE", async () => {
    const validatorFn = getGossipValidatorFn(
      getHandlers(GossipType.beacon_block, () => Promise.reject(ignoreError)),
      modules
    );

    const result = await validatorFn(getMessageInfo(GossipType.beacon_block));

    expect(result).toBe(TopicValidatorResult.Ignore);
    expect(core.reportPeer).not.toHaveBeenCalled();
  });

  it("does not report peer on non-GossipActionError", async () => {
    const validatorFn = getGossipValidatorFn(
      getHandlers(GossipType.beacon_block, () => Promise.reject(new Error("unexpected"))),
      modules
    );

    const result = await validatorFn(getMessageInfo(GossipType.beacon_block));

    expect(result).toBe(TopicValidatorResult.Ignore);
    expect(core.reportPeer).not.toHaveBeenCalled();
  });

  it("does not report peer on ACCEPT", async () => {
    const validatorFn = getGossipValidatorFn(
      getHandlers(GossipType.beacon_block, () => Promise.resolve()),
      modules
    );

    const result = await validatorFn(getMessageInfo(GossipType.beacon_block));

    expect(result).toBe(TopicValidatorResult.Accept);
    expect(core.reportPeer).not.toHaveBeenCalled();
  });

  describe("batch beacon_attestation", () => {
    const attRejectError = new AttestationError(GossipAction.REJECT, {
      code: AttestationErrorCode.INVALID_SIGNATURE,
    });
    const attIgnoreError = new AttestationError(GossipAction.IGNORE, {
      code: AttestationErrorCode.BAD_TARGET_EPOCH,
    });

    it("reports only peers of rejected messages", async () => {
      const gossipHandlers = {
        [GossipType.beacon_attestation]: () => Promise.resolve([null, attRejectError, attIgnoreError]),
      } as unknown as GossipHandlers;
      const validatorBatchFn = getGossipValidatorBatchFn(gossipHandlers, modules);

      const messageInfos = [
        getMessageInfo(GossipType.beacon_attestation),
        {...getMessageInfo(GossipType.beacon_attestation), propagationSource: "rejected-peer"},
        getMessageInfo(GossipType.beacon_attestation),
      ];

      const results = await validatorBatchFn(messageInfos);

      expect(results).toEqual([TopicValidatorResult.Accept, TopicValidatorResult.Reject, TopicValidatorResult.Ignore]);
      expect(core.reportPeer).toHaveBeenCalledOnce();
      expect(core.reportPeer).toHaveBeenCalledWith(
        "rejected-peer",
        PeerAction.MidToleranceError,
        AttestationErrorCode.INVALID_SIGNATURE
      );
    });
  });
});
