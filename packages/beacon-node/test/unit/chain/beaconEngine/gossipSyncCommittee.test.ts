import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineMode} from "../../../../src/chain/beaconEngine/options.js";
import {GossipAction, SyncCommitteeError, SyncCommitteeErrorCode} from "../../../../src/chain/errors/index.js";
import {SyncCommitteeMessagePool} from "../../../../src/chain/opPools/syncCommitteeMessagePool.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";
import * as syncValidation from "../../../../src/chain/validation/syncCommittee.js";
import {INetworkCore} from "../../../../src/network/core/index.js";
import {NetworkEventBus} from "../../../../src/network/events.js";
import {GossipType, SequentialGossipHandler} from "../../../../src/network/gossip/interface.js";
import {getGossipHandlers} from "../../../../src/network/processor/gossipHandlers.js";
import {getMockedBeaconChain, withBeaconEngineFacade} from "../../../mocks/mockedBeaconChain.js";

describe.each([BeaconEngineMode.MainThread, BeaconEngineMode.Worker])(
  "sync committee gossip insertion (beaconEngineMode=%s)",
  (beaconEngineMode) => {
    let engine: BeaconEngineCore;
    let handler: SequentialGossipHandler<GossipType.sync_committee>;
    const message = ssz.altair.SyncCommitteeMessage.defaultValue();
    const params: Parameters<typeof handler>[0] = {
      gossipData: {serializedData: ssz.altair.SyncCommitteeMessage.serialize(message)},
      peerIdStr: "peer",
      seenTimestampSec: 1,
      topic: {boundary: {fork: ForkName.altair, epoch: 0}, type: GossipType.sync_committee, subnet: 0},
    };

    beforeEach(() => {
      vi.useFakeTimers();
      const chain = getMockedBeaconChain();
      chain.opts.beaconEngineMode = beaconEngineMode;
      engine = chain.beaconEngine;
      engine.validateGossipSyncCommitteeBytes = BeaconEngineCore.prototype.validateGossipSyncCommitteeBytes;
      engine.syncCommitteeMessagePool = new SyncCommitteeMessagePool(engine.config, engine.clock);
      vi.spyOn(engine.syncCommitteeMessagePool, "add").mockReturnValue(InsertOutcome.NewData);
      vi.spyOn(syncValidation, "validateGossipSyncCommittee").mockResolvedValue({indicesInSubcommittee: [1, 4]});
      const handlers = getGossipHandlers({
        chain: withBeaconEngineFacade(chain),
        config: chain.config,
        logger: chain.logger,
        metrics: null,
        events: new NetworkEventBus(),
        core: {} as INetworkCore,
      });
      handler = handlers[GossipType.sync_committee] as SequentialGossipHandler<GossipType.sync_committee>;
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("returns acceptance before inserting every validated subcommittee position", async () => {
      expect(await handler(params)).toEqual({err: null, result: undefined});
      expect(engine.syncCommitteeMessagePool.add).not.toHaveBeenCalled();

      await vi.runAllTimersAsync();

      expect(vi.mocked(engine.syncCommitteeMessagePool.add).mock.calls).toEqual([
        [0, message, 1],
        [0, message, 4],
      ]);
      expect(engine.logger.debug).not.toHaveBeenCalled();
    });

    it("contains deferred insertion errors after returning acceptance", async () => {
      const error = new Error("pool insertion failed");
      vi.mocked(engine.syncCommitteeMessagePool.add).mockImplementation(() => {
        throw error;
      });

      expect(await handler(params)).toEqual({err: null, result: undefined});
      expect(engine.logger.debug).not.toHaveBeenCalled();

      await vi.runAllTimersAsync();

      expect(engine.syncCommitteeMessagePool.add).toHaveBeenCalledOnce();
      expect(engine.logger.debug).toHaveBeenCalledExactlyOnceWith(
        "Error adding to syncCommittee pool",
        {subnet: 0},
        error
      );
    });

    it.each([GossipAction.IGNORE, GossipAction.REJECT])("does not insert after %s", async (action) => {
      const error = new SyncCommitteeError(
        action,
        action === GossipAction.IGNORE
          ? {code: SyncCommitteeErrorCode.NOT_CURRENT_SLOT, slot: 0, currentSlot: 1}
          : {code: SyncCommitteeErrorCode.INVALID_SIGNATURE}
      );
      vi.mocked(syncValidation.validateGossipSyncCommittee).mockRejectedValue(error);

      expect(await handler(params)).toMatchObject({
        err: {status: action === GossipAction.IGNORE ? "ignore" : "reject", code: error.type.code},
      });
      await vi.runAllTimersAsync();

      expect(engine.syncCommitteeMessagePool.add).not.toHaveBeenCalled();
    });
  }
);
