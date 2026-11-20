import {TopicValidatorResult} from "@libp2p/gossipsub";
import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {
  AttestationErrorCode,
  BlockErrorCode,
  GossipErrorCode,
  VoluntaryExitErrorCode,
} from "../../../../src/chain/errors/index.js";
import {INetworkCore} from "../../../../src/network/core/index.js";
import {NetworkEventBus} from "../../../../src/network/events.js";
import {GossipType} from "../../../../src/network/gossip/interface.js";
import {PeerAction} from "../../../../src/network/peers/index.js";
import {AggregatorTracker} from "../../../../src/network/processor/aggregatorTracker.js";
import {getGossipHandlers} from "../../../../src/network/processor/gossipHandlers.js";
import {getGossipValidatorFn, rejectPeerAction} from "../../../../src/network/processor/gossipValidatorFn.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";

describe("rejectPeerAction", () => {
  it.each(Object.values(GossipType))("uses low tolerance for malformed SSZ on %s", (type) => {
    expect(rejectPeerAction(type, GossipErrorCode.INVALID_SERIALIZED_BYTES_ERROR_CODE)).toBe(
      PeerAction.LowToleranceError
    );
  });

  it.each([
    [GossipType.beacon_block, PeerAction.LowToleranceError],
    [GossipType.beacon_attestation, PeerAction.MidToleranceError],
    [GossipType.voluntary_exit, PeerAction.HighToleranceError],
  ] as const)("preserves the default penalty on %s", (type, action) => {
    expect(rejectPeerAction(type, GossipErrorCode.INVALID_SLOT)).toBe(action);
  });

  it.each([
    [GossipType.beacon_block, BlockErrorCode.PROPOSAL_SIGNATURE_INVALID],
    [GossipType.beacon_attestation, AttestationErrorCode.INVALID_SIGNATURE],
    [GossipType.voluntary_exit, VoluntaryExitErrorCode.INVALID_SIGNATURE],
  ] as const)("preserves fatal signature penalties on %s", (type, code) => {
    expect(rejectPeerAction(type, code)).toBe(PeerAction.Fatal);
  });
});

describe("gossip SSZ rejection", () => {
  it.each([GossipType.beacon_aggregate_and_proof, GossipType.voluntary_exit] as const)(
    "reports malformed %s once with low tolerance without marking the peer fatal",
    async (type) => {
      const reportPeer = vi.fn();
      const onFatalPeer = vi.fn();
      const modules = {
        chain: getMockedBeaconChain(),
        config: createBeaconConfig(defaultConfig, new Uint8Array(32)),
        logger: getMockedLogger(),
        metrics: null,
        core: {reportPeer} as unknown as INetworkCore,
        events: new NetworkEventBus(),
        aggregatorTracker: new AggregatorTracker(),
      };
      const validator = getGossipValidatorFn(getGossipHandlers(modules, {}), modules, onFatalPeer);
      const propagationSource = "16Uiu2HAmInvalidSszPeer";
      const data =
        type === GossipType.beacon_aggregate_and_proof
          ? ssz.phase0.SignedAggregateAndProof.serialize(ssz.phase0.SignedAggregateAndProof.defaultValue())
          : new Uint8Array();
      if (type === GossipType.beacon_aggregate_and_proof) {
        // Preserve the permitted byte length but corrupt the first variable-field offset.
        new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(0, 0, true);
      }

      expect(
        await validator({
          topic: {type, boundary: {fork: ForkName.phase0, epoch: 0}},
          msg: {type: "unsigned", topic: type, data},
          propagationSource,
          clientAgent: "test",
          clientVersion: "test",
          seenTimestampSec: 0,
          msgSlot: null,
          reportPeer,
        })
      ).toBe(TopicValidatorResult.Reject);
      expect(reportPeer).toHaveBeenCalledExactlyOnceWith(
        PeerAction.LowToleranceError,
        GossipErrorCode.INVALID_SERIALIZED_BYTES_ERROR_CODE
      );
      expect(onFatalPeer).not.toHaveBeenCalled();
    }
  );
});
