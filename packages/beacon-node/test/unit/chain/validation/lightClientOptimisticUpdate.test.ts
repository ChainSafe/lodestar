import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {altair, ssz} from "@lodestar/types";
import {RequiredSelective} from "@lodestar/utils";
import {LightClientErrorCode} from "../../../../src/chain/errors/lightClientError.js";
import {IBeaconChain} from "../../../../src/chain/index.js";
import {validateLightClientOptimisticUpdate} from "../../../../src/chain/validation/lightClientOptimisticUpdate.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";

describe("Light Client Optimistic Update validation", () => {
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  const config = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 1,
    BELLATRIX_FORK_EPOCH: 3,
    CAPELLA_FORK_EPOCH: Infinity,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(async () => {
    vi.clearAllTimers();
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  function mockChain(): RequiredSelective<IBeaconChain, "lightClientServer"> {
    const chain = getMockedBeaconChain({config});
    vi.spyOn(chain.lightClientServer, "getOptimisticUpdate");
    return chain;
  }

  it("should return invalid - optimistic update already forwarded", async () => {
    const lightclientOptimisticUpdate: altair.LightClientOptimisticUpdate =
      ssz.altair.LightClientOptimisticUpdate.defaultValue();

    lightclientOptimisticUpdate.attestedHeader.beacon.slot = 2;

    const chain = mockChain();
    vi.spyOn(chain.lightClientServer, "getOptimisticUpdate").mockImplementation(() => {
      const defaultValue = ssz.altair.LightClientOptimisticUpdate.defaultValue();
      // make the local slot higher than gossiped
      defaultValue.attestedHeader.beacon.slot = lightclientOptimisticUpdate.attestedHeader.beacon.slot + 1;
      return defaultValue;
    });

    expect(() => {
      validateLightClientOptimisticUpdate(config, chain, lightclientOptimisticUpdate);
    }).toThrow(LightClientErrorCode.OPTIMISTIC_UPDATE_ALREADY_FORWARDED);
  });

  it("should return invalid - optimistic update received too early", async () => {
    const lightclientOptimisticUpdate: altair.LightClientOptimisticUpdate =
      ssz.altair.LightClientOptimisticUpdate.defaultValue();
    lightclientOptimisticUpdate.attestedHeader.beacon.slot = 2;
    lightclientOptimisticUpdate.signatureSlot = 4;

    const chain = mockChain();
    const defaultValue = ssz.altair.LightClientOptimisticUpdate.defaultValue();
    defaultValue.attestedHeader.beacon.slot = 1;
    vi.spyOn(chain.lightClientServer, "getOptimisticUpdate").mockReturnValue(defaultValue);

    // make update too early
    vi.spyOn(chain.clock, "msFromSlot").mockReturnValue(0);

    expect(() => {
      validateLightClientOptimisticUpdate(config, chain, lightclientOptimisticUpdate);
    }).toThrow(LightClientErrorCode.OPTIMISTIC_UPDATE_RECEIVED_TOO_EARLY);
  });

  it("should return invalid - optimistic update not matching local", async () => {
    const lightclientOptimisticUpdate: altair.LightClientOptimisticUpdate =
      ssz.altair.LightClientOptimisticUpdate.defaultValue();
    lightclientOptimisticUpdate.attestedHeader.beacon.slot = 42;

    const chain = mockChain();

    // make update not too early
    vi.spyOn(chain.clock, "msFromSlot").mockReturnValue(config.getSyncMessageDueMs(ForkName.altair) + 1000);

    // make lightclientserver return another update with different value from gossiped
    chain.lightClientServer.getOptimisticUpdate = () => {
      const defaultValue = ssz.altair.LightClientOptimisticUpdate.defaultValue();
      defaultValue.attestedHeader.beacon.slot = 1;
      return defaultValue;
    };

    expect(() => {
      validateLightClientOptimisticUpdate(config, chain, lightclientOptimisticUpdate);
    }).toThrow(LightClientErrorCode.OPTIMISTIC_UPDATE_NOT_MATCHING_LOCAL);
  });

  it("should return invalid - not matching local when no local optimistic update yet", async () => {
    const lightclientOptimisticUpdate: altair.LightClientOptimisticUpdate =
      ssz.altair.LightClientOptimisticUpdate.defaultValue();
    lightclientOptimisticUpdate.attestedHeader.beacon.slot = 42;

    const chain = mockChain();
    chain.lightClientServer.getOptimisticUpdate = () => ssz.altair.LightClientOptimisticUpdate.defaultValue();

    // make update not too early
    vi.spyOn(chain.clock, "msFromSlot").mockReturnValue(config.getSyncMessageDueMs(ForkName.altair) + 1000);

    // chain getOptimisticUpdate not mocked.
    // localOptimisticUpdate will be null
    // latestForwardedOptimisticSlot will be -1
    expect(() => {
      validateLightClientOptimisticUpdate(config, chain, lightclientOptimisticUpdate);
    }).toThrow(LightClientErrorCode.OPTIMISTIC_UPDATE_NOT_MATCHING_LOCAL);
  });

  it("should not throw for valid update", async () => {
    const lightclientOptimisticUpdate: altair.LightClientOptimisticUpdate =
      ssz.altair.LightClientOptimisticUpdate.defaultValue();
    const chain = mockChain();

    // satisfy:
    // No other optimistic_update with a lower or equal attested_header.beacon.slot was already forwarded on the network
    lightclientOptimisticUpdate.attestedHeader.beacon.slot = 2;

    // satisfy:
    // [IGNORE] The optimistic_update is received after the block at `signature_slot` was given enough time to propagate
    // through the network -- i.e. validate that `get_sync_message_due_ms(epoch)` milliseconds
    // (with a `MAXIMUM_GOSSIP_CLOCK_DISPARITY` allowance) has transpired since the start of `signature_slot`.
    vi.spyOn(chain.clock, "msFromSlot").mockReturnValue(config.getSyncMessageDueMs(ForkName.altair) + 1000);

    // satisfy:
    // [IGNORE] The received optimistic_update matches the locally computed one exactly
    chain.lightClientServer.getOptimisticUpdate = () => {
      return lightclientOptimisticUpdate;
    };

    expect(() => {
      validateLightClientOptimisticUpdate(config, chain, lightclientOptimisticUpdate);
    }).not.toThrow("Expected validateLightclientOptimisticUpdate not to throw");
  });
});
