import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {BlockInputPreData, BlockInputSource} from "../../../../../../src/chain/blocks/blockInput/index.js";
import {getApiTestModules} from "../../../../../utils/api.js";

afterEach(() => vi.restoreAllMocks());

describe("block API monitor forwarding", () => {
  it.each([true, false])(
    "records receipt before publishing, including when publication succeeds=%s",
    async (success) => {
      vi.spyOn(Date, "now").mockReturnValue(12_000);
      const modules = getApiTestModules();
      const block = ssz.phase0.SignedBeaconBlock.defaultValue();
      const blockRoot = toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(
        BlockInputPreData.createFromBlock({
          forkName: ForkName.phase0,
          block,
          blockRootHex: blockRoot,
          source: BlockInputSource.api,
          seenTimestampSec: 12,
          daOutOfRange: false,
        })
      );
      const observed = vi.spyOn(modules.chain.beaconEngine, "registerApiBlock");
      modules.chain.processBlock = vi.fn().mockResolvedValue(undefined);
      modules.network.publishBeaconBlock = vi.fn().mockImplementation(async () => {
        expect(observed).toHaveBeenCalledExactlyOnceWith(12, {slot: 0, proposerIndex: 0, blockRoot});
        if (!success) throw new Error("publication failed");
        return 1;
      });
      const pending = getBeaconBlockApi(modules).publishBlockV2({
        signedBlockContents: {signedBlock: block},
        broadcastValidation: routes.beacon.BroadcastValidation.none,
      });
      if (success) await expect(pending).resolves.toBeUndefined();
      else await expect(pending).rejects.toThrow("publication failed");
      expect(observed).toHaveBeenCalledOnce();
      expect(modules.network.publishBeaconBlock).toHaveBeenCalledOnce();
    }
  );
});
