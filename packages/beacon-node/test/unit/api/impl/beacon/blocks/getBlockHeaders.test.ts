import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {fromHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import type {IBeaconEngine} from "../../../../../../src/chain/interface.js";
import {withBeaconEngineFacade} from "../../../../../mocks/mockedBeaconChain.js";
import {getApiTestModules} from "../../../../../utils/api.js";

describe("api - beacon - getBlockHeaders", () => {
  let api: ReturnType<typeof getBeaconBlockApi>;
  const getBlockHeaders = vi.fn<IBeaconEngine["getBlockHeaders"]>();
  const parentRoot = `0x${"ab".repeat(32)}`;

  beforeEach(() => {
    const modules = getApiTestModules();
    const chain = withBeaconEngineFacade(modules.chain);
    getBlockHeaders.mockReset();
    chain.beaconEngine.getBlockHeaders = getBlockHeaders;
    api = getBeaconBlockApi({...modules, chain});
  });

  it.each([{}, {slot: 0}, {parentRoot}, {slot: 1, parentRoot}])(
    "delegates the complete query to BeaconEngine with byte roots: %j",
    async (opts: {slot?: number; parentRoot?: string}) => {
      const response = {
        data: [routes.beacon.block.BlockHeaderResponseType.defaultValue()],
        meta: {executionOptimistic: true, finalized: false},
      };
      getBlockHeaders.mockResolvedValue(response);
      expect(await api.getBlockHeaders(opts)).toBe(response);
      expect(getBlockHeaders).toHaveBeenCalledExactlyOnceWith({
        slot: opts.slot,
        parentRoot: opts.parentRoot ? fromHex(opts.parentRoot) : undefined,
      });
    }
  );
});
