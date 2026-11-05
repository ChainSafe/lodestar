import {expect, it, vi} from "vitest";
import {NativeNetworkErrorCode} from "../../../src/network/core/native/errors.js";
import {Network, NetworkInitModules} from "../../../src/network/network.js";
import {BeaconNode, BeaconNodeInitModules} from "../../../src/node/nodejs.js";
import {defaultOptions} from "../../../src/node/options.js";

function untouched<T extends object>(): T {
  return new Proxy({} as T, {
    get(_target, property) {
      throw Error(`Startup accessed ${String(property)} before validating options`);
    },
  });
}

const networkOptions = {...defaultOptions.network, backend: "native" as const, tcp: false, gossipsubD: 9};
const expectedError = {
  type: {code: NativeNetworkErrorCode.CONFIGURATION, resource: expect.stringContaining("gossipsubD=8")},
};

it("rejects native options before accessing node services or anchor state", async () => {
  const modules: BeaconNodeInitModules = {
    opts: {...defaultOptions, network: networkOptions},
    config: untouched(),
    pubkeyCache: untouched(),
    db: untouched(),
    logger: untouched(),
    processShutdownCallback: vi.fn(),
    privateKey: untouched(),
    dataDir: "unused",
    dataColumnDir: "unused",
    anchorState: untouched(),
    isAnchorStateFinalized: true,
    earliestAvailableSlot: 0,
  };
  await expect(BeaconNode.init(modules)).rejects.toMatchObject(expectedError);
  expect(modules.processShutdownCallback).not.toHaveBeenCalled();
});

it("rejects native options before standalone network initialization reads chain state", async () => {
  const modules: NetworkInitModules = {
    opts: networkOptions,
    config: untouched(),
    privateKey: untouched(),
    logger: untouched(),
    metrics: null,
    chain: untouched(),
    db: untouched(),
    getReqRespHandler: vi.fn(),
    processShutdownCallback: vi.fn(),
  };
  await expect(Network.init(modules)).rejects.toMatchObject(expectedError);
  expect(modules.getReqRespHandler).not.toHaveBeenCalled();
  expect(modules.processShutdownCallback).not.toHaveBeenCalled();
});
