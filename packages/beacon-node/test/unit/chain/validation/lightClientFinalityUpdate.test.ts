import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {altair, ssz} from "@lodestar/types";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {RequiredSelective} from "@lodestar/utils";
import {validateLightClientFinalityUpdate} from "../../../../src/chain/validation/lightClientFinalityUpdate.js";
import {LightClientErrorCode} from "../../../../src/chain/errors/lightClientError.js";
import {IBeaconChain} from "../../../../src/chain/index.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";

describe("Light Client Finality Update validation", function () {
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
    const chain = getMockedBeaconChain();
    vi.spyOn(chain, "genesisTime", "get").mockReturnValue(0);
    return chain;
  }

  it("should return invalid - finality update already forwarded", async () => {
    const lightclientFinalityUpdate: altair.LightClientFinalityUpdate =
      ssz.altair.LightClientFinalityUpdate.defaultValue();
    lightclientFinalityUpdate.finalizedHeader.beacon.slot = 2;

    const chain = mockChain();
    vi.spyOn(chain.lightClientServer, "getFinalityUpdate").mockImplementation(() => {
      const defaultValue = ssz.altair.LightClientFinalityUpdate.defaultValue();
      // make the local slot higher than gossiped
      defaultValue.finalizedHeader.beacon.slot = lightclientFinalityUpdate.finalizedHeader.beacon.slot + 1;
      return defaultValue;
    });

    expect(() => {
      validateLightClientFinalityUpdate(config, chain, lightclientFinalityUpdate);
    }).toThrow(LightClientErrorCode.FINALITY_UPDATE_ALREADY_FORWARDED);
  });

  it("should return invalid - finality update received too early", async () => {
    //No other optimistic_update with a lower or equal attested_header.beacon.slot was already forwarded on the network
    const lightClientFinalityUpdate: altair.LightClientFinalityUpdate =
      ssz.altair.LightClientFinalityUpdate.defaultValue();
    lightClientFinalityUpdate.finalizedHeader.beacon.slot = 2;
    lightClientFinalityUpdate.signatureSlot = 4;

    const chain = mockChain();
    const defaultValue = ssz.altair.LightClientFinalityUpdate.defaultValue();
    defaultValue.finalizedHeader.beacon.slot = 1;
    vi.spyOn(chain.lightClientServer, "getFinalityUpdate").mockReturnValue(defaultValue);

    expect(() => {
      validateLightClientFinalityUpdate(config, chain, lightClientFinalityUpdate);
    }).toThrow(LightClientErrorCode.FINALITY_UPDATE_RECEIVED_TOO_EARLY);
  });

  it("should return invalid - finality update not matching local", async () => {
    const lightClientFinalityUpdate: altair.LightClientFinalityUpdate =
      ssz.altair.LightClientFinalityUpdate.defaultValue();
    lightClientFinalityUpdate.finalizedHeader.beacon.slot = 42;
    lightClientFinalityUpdate.attestedHeader.beacon.slot = lightClientFinalityUpdate.finalizedHeader.beacon.slot + 1;

    const chain = mockChain();

    // make lightclientserver return another update with different value from gossiped
    vi.spyOn(chain.lightClientServer, "getFinalityUpdate").mockImplementation(() => {
      const defaultValue = ssz.altair.LightClientFinalityUpdate.defaultValue();
      defaultValue.finalizedHeader.beacon.slot = 41;
      return defaultValue;
    });

    // make update not too early
    const timeAtSignatureSlot =
      computeTimeAtSlot(config, lightClientFinalityUpdate.signatureSlot, chain.genesisTime) * 1000;
    vi.advanceTimersByTime(timeAtSignatureSlot + (1 / 3) * (config.SECONDS_PER_SLOT + 1) * 1000);

    expect(() => {
      validateLightClientFinalityUpdate(config, chain, lightClientFinalityUpdate);
    }).toThrow(LightClientErrorCode.FINALITY_UPDATE_NOT_MATCHING_LOCAL);
  });

  it("should return invalid - not matching local when no local finality update yet", async () => {
    const lightClientFinalityUpdate: altair.LightClientFinalityUpdate =
      ssz.altair.LightClientFinalityUpdate.defaultValue();
    lightClientFinalityUpdate.finalizedHeader.beacon.slot = 42;
    lightClientFinalityUpdate.attestedHeader.beacon.slot = lightClientFinalityUpdate.finalizedHeader.beacon.slot + 1;

    const chain = mockChain();
    vi.spyOn(chain.lightClientServer, "getFinalityUpdate").mockImplementation(() => {
      return ssz.altair.LightClientFinalityUpdate.defaultValue();
    });

    // make update not too early
    const timeAtSignatureSlot =
      computeTimeAtSlot(config, lightClientFinalityUpdate.signatureSlot, chain.genesisTime) * 1000;
    vi.advanceTimersByTime(timeAtSignatureSlot + (1 / 3) * (config.SECONDS_PER_SLOT + 1) * 1000);

    // chain's getFinalityUpdate not mocked.
    // localFinalityUpdate will be null
    // latestForwardedFinalitySlot will be -1

    expect(() => {
      validateLightClientFinalityUpdate(config, chain, lightClientFinalityUpdate);
    }).toThrow(LightClientErrorCode.FINALITY_UPDATE_NOT_MATCHING_LOCAL);
  });

  it("should not throw for valid update", async () => {
    const lightClientFinalityUpdate: altair.LightClientFinalityUpdate =
      ssz.altair.LightClientFinalityUpdate.defaultValue();
    const chain = mockChain();

    // satisfy:
    // No other finality_update with a lower or equal finalized_header.beacon.slot was already forwarded on the network
    lightClientFinalityUpdate.finalizedHeader.beacon.slot = 2;
    lightClientFinalityUpdate.signatureSlot = lightClientFinalityUpdate.finalizedHeader.beacon.slot + 1;

    vi.spyOn(chain.lightClientServer, "getFinalityUpdate").mockImplementation(() => {
      const defaultValue = ssz.altair.LightClientFinalityUpdate.defaultValue();
      defaultValue.finalizedHeader.beacon.slot = 1;
      return defaultValue;
    });

    // satisfy:
    // [IGNORE] The finality_update is received after the block at signature_slot was given enough time to propagate
    // through the network -- i.e. validate that one-third of finality_update.signature_slot has transpired
    // (SECONDS_PER_SLOT / INTERVALS_PER_SLOT seconds after the start of the slot, with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
    // const currentTime = computeTimeAtSlot(config, chain.clock.currentSlotWithGossipDisparity, chain.genesisTime);
    const timeAtSignatureSlot =
      computeTimeAtSlot(config, lightClientFinalityUpdate.signatureSlot, chain.genesisTime) * 1000;
    vi.advanceTimersByTime(timeAtSignatureSlot + (1 / 3) * (config.SECONDS_PER_SLOT + 1) * 1000);

    // satisfy:
    // [IGNORE] The received finality_update matches the locally computed one exactly
    vi.spyOn(chain.lightClientServer, "getFinalityUpdate").mockImplementation(() => {
      return lightClientFinalityUpdate;
    });

    expect(() => {
      validateLightClientFinalityUpdate(config, chain, lightClientFinalityUpdate);
    }).not.toThrow("Expected validateLightClientFinalityUpdate not to throw");
  });
});
