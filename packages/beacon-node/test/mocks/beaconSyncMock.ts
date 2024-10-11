import {Mocked, vi} from "vitest";
import {BeaconSync} from "../../src/sync/index.js";

export type MockedBeaconSync = Mocked<BeaconSync>;

vi.mock("../../src/sync/index.js", async (importActual) => {
  const mod = await importActual<typeof import("../../src/sync/index.js")>();

  const BeaconSync = vi.fn().mockImplementation(() => {
    const sync = {
      isSynced: vi.fn(),
    };
    Object.defineProperty(sync, "state", {value: undefined, configurable: true});

    return sync;
  });

  return {
    ...mod,
    BeaconSync,
  };
});

export function getMockedBeaconSync(): MockedBeaconSync {
  return vi.mocked(new BeaconSync({} as any, {} as any));
}

vi.resetModules();
