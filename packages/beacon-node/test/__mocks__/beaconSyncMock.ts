/* eslint-disable @typescript-eslint/naming-convention */
import {MockedObject, vi} from "vitest";
import {BeaconSync} from "../../src/sync/index.js";

export type MockedBeaconSync = MockedObject<BeaconSync>;

vi.mock("../../src/sync/index.js", async (requireActual) => {
  const mod = await requireActual<typeof import("../../src/sync/index.js")>();

  const BeaconSync = vi.fn().mockImplementation(() => {
    const sync = {};
    Object.defineProperty(sync, "state", {value: undefined, configurable: true});

    return sync;
  });

  return {
    ...mod,
    BeaconSync,
  };
});

export function getMockedBeaconSync(): MockedBeaconSync {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  return vi.mocked(new BeaconSync({})) as MockedBeaconSync;
}
