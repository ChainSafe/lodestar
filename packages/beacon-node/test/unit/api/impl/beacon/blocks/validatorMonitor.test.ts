import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {defaultApiOptions} from "../../../../../../src/api/options.js";
import {BlockInputColumns, BlockInputSource} from "../../../../../../src/chain/blocks/blockInput/index.js";
import {getApiTestModules} from "../../../../../utils/api.js";

afterEach(() => vi.restoreAllMocks());

describe("block API monitor forwarding", () => {
  it.each([true, false])(
    "records receipt before publishing, including when publication succeeds=%s",
    async (success) => {
      vi.spyOn(Date, "now").mockReturnValue(12_000);
      const config = createBeaconConfig(getConfig(ForkName.fulu), new Uint8Array(32));
      const modules = getApiTestModules({config});
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      const blockRoot = toRootHex(ssz.fulu.BeaconBlock.hashTreeRoot(block.message));
      modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(
        BlockInputColumns.createFromBlock({
          forkName: ForkName.fulu,
          block,
          blockRootHex: blockRoot,
          source: BlockInputSource.api,
          seenTimestampSec: 12,
          daOutOfRange: false,
          sampledColumns: [],
          custodyColumns: [],
        })
      );
      const observed = vi.spyOn(modules.chain.beaconEngine, "registerApiBlock");
      modules.chain.processBlock = vi.fn().mockResolvedValue(undefined);
      modules.chain.beaconEngine.validateGossipBlock = vi
        .fn()
        .mockResolvedValue({err: null, result: {skippedSlots: 0}});
      modules.network.publishBeaconBlock = vi.fn().mockImplementation(async () => {
        expect(observed).toHaveBeenCalledExactlyOnceWith(12, {slot: 0, proposerIndex: 0, blockRoot});
        if (!success) throw new Error("publication failed");
        return 1;
      });
      const pending = getBeaconBlockApi(defaultApiOptions, modules).publishBlockV2({
        signedBlockContents: {signedBlock: block, blobs: [], kzgProofs: []},
        broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      });
      if (success) await expect(pending).resolves.toBeUndefined();
      else await expect(pending).rejects.toThrow("publication failed");
      expect(observed).toHaveBeenCalledOnce();
      expect(modules.network.publishBeaconBlock).toHaveBeenCalledOnce();
    }
  );
});
