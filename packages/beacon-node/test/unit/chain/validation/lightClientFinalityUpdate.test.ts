import {expect} from "chai";
import sinon from "sinon";
import {createIBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {altair, ssz} from "@lodestar/types";

import {computeTimeAtSlot} from "@lodestar/state-transition";
import {generateEmptySignedBlock} from "../../../utils/block.js";
import {MockBeaconChain} from "../../../utils/mocks/chain/chain.js";
import {generateState} from "../../../utils/state.js";
import {validateLightClientFinalityUpdate} from "../../../../src/chain/validation/lightClientFinalityUpdate.js";
import {LightClientErrorCode} from "../../../../src/chain/errors/lightClientError.js";
import {IBeaconChain} from "../../../../src/chain/index.js";

describe("Light Client Finality Update validation", function () {
  let fakeClock: sinon.SinonFakeTimers;
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  beforeEach(() => {
    fakeClock = sinon.useFakeTimers();
  });
  afterEach(async () => {
    fakeClock.restore();
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  function mockChain(): IBeaconChain {
    const block = generateEmptySignedBlock();
    const state = generateState({
      finalizedCheckpoint: {
        epoch: 0,
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      },
    });

    const beaconConfig = createIBeaconConfig(config, state.genesisValidatorsRoot);
    const chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: BigInt(0),
      state,
      config: beaconConfig,
    });

    afterEachCallbacks.push(async () => {
      await chain.close();
    });

    return chain;
  }

  it("should return invalid - finality update already forwarded", async () => {
    const lightclientFinalityUpdate: altair.LightClientFinalityUpdate = ssz.altair.LightClientFinalityUpdate.defaultValue();
    lightclientFinalityUpdate.finalizedHeader.slot = 2;

    const chain = mockChain();
    chain.lightClientServer.getFinalityUpdate = () => {
      const defaultValue = ssz.altair.LightClientFinalityUpdate.defaultValue();
      // make the local slot higher than gossiped
      defaultValue.finalizedHeader.slot = lightclientFinalityUpdate.finalizedHeader.slot + 1;
      return defaultValue;
    };

    expect(() => {
      validateLightClientFinalityUpdate(config, chain, lightclientFinalityUpdate);
    }).to.throw(
      LightClientErrorCode.FINALITY_UPDATE_ALREADY_FORWARDED,
      "Expected LightClientErrorCode.FINALITY_UPDATE_ALREADY_FORWARDED to be thrown"
    );
  });

  it("should return invalid - finality update received too early", async () => {
    //No other optimistic_update with a lower or equal attested_header.slot was already forwarded on the network
    const lightClientFinalityUpdate: altair.LightClientFinalityUpdate = ssz.altair.LightClientFinalityUpdate.defaultValue();
    lightClientFinalityUpdate.finalizedHeader.slot = 2;
    lightClientFinalityUpdate.signatureSlot = 4;

    const chain = mockChain();
    chain.lightClientServer.getFinalityUpdate = () => {
      const defaultValue = ssz.altair.LightClientFinalityUpdate.defaultValue();
      defaultValue.finalizedHeader.slot = 1;
      return defaultValue;
    };

    expect(() => {
      validateLightClientFinalityUpdate(config, chain, lightClientFinalityUpdate);
    }).to.throw(
      LightClientErrorCode.FINALITY_UPDATE_RECEIVED_TOO_EARLY,
      "Expected LightClientErrorCode.FINALITY_UPDATE_RECEIVED_TOO_EARLY to be thrown"
    );
  });

  it("should return invalid - finality update not matching local", async () => {
    const lightClientFinalityUpdate: altair.LightClientFinalityUpdate = ssz.altair.LightClientFinalityUpdate.defaultValue();
    lightClientFinalityUpdate.finalizedHeader.slot = 2;
    lightClientFinalityUpdate.signatureSlot = lightClientFinalityUpdate.finalizedHeader.slot + 1;

    const chain = mockChain();

    // make lightclientserver return another update with different value from gossiped
    chain.lightClientServer.getFinalityUpdate = () => {
      const defaultValue = ssz.altair.LightClientFinalityUpdate.defaultValue();
      defaultValue.finalizedHeader.slot = 1;
      return defaultValue;
    };

    // make update not too early
    const timeAtSignatureSlot =
      computeTimeAtSlot(config, lightClientFinalityUpdate.signatureSlot, chain.genesisTime) * 1000;
    fakeClock.tick(timeAtSignatureSlot + (1 / 3) * (config.SECONDS_PER_SLOT + 1) * 1000);

    expect(() => {
      validateLightClientFinalityUpdate(config, chain, lightClientFinalityUpdate);
    }).to.throw(
      LightClientErrorCode.FINALITY_UPDATE_NOT_MATCHING_LOCAL,
      "Expected LightClientErrorCode.FINALITY_UPDATE_NOT_MATCHING_LOCAL to be thrown"
    );
  });

  it("should return invalid - not matching local when no local finality update yet", async () => {
    const lightClientFinalityUpdate: altair.LightClientFinalityUpdate = ssz.altair.LightClientFinalityUpdate.defaultValue();
    lightClientFinalityUpdate.finalizedHeader.slot = 2;
    lightClientFinalityUpdate.signatureSlot = lightClientFinalityUpdate.finalizedHeader.slot + 1;

    const chain = mockChain();

    // make update not too early
    const timeAtSignatureSlot =
      computeTimeAtSlot(config, lightClientFinalityUpdate.signatureSlot, chain.genesisTime) * 1000;
    fakeClock.tick(timeAtSignatureSlot + (1 / 3) * (config.SECONDS_PER_SLOT + 1) * 1000);

    // chain's getFinalityUpdate not mocked.
    // localFinalityUpdate will be null
    // latestForwardedFinalitySlot will be -1

    expect(() => {
      validateLightClientFinalityUpdate(config, chain, lightClientFinalityUpdate);
    }).to.throw(
      LightClientErrorCode.FINALITY_UPDATE_NOT_MATCHING_LOCAL,
      "Expected LightClientErrorCode.FINALITY_UPDATE_NOT_MATCHING_LOCAL to be thrown"
    );
  });

  it("should not throw for valid update", async () => {
    const lightClientFinalityUpdate: altair.LightClientFinalityUpdate = ssz.altair.LightClientFinalityUpdate.defaultValue();
    const chain = mockChain();

    // satisfy:
    // No other finality_update with a lower or equal finalized_header.slot was already forwarded on the network
    lightClientFinalityUpdate.finalizedHeader.slot = 2;

    chain.lightClientServer.getFinalityUpdate = () => {
      const defaultValue = ssz.altair.LightClientFinalityUpdate.defaultValue();
      defaultValue.finalizedHeader.slot = 1;
      return defaultValue;
    };

    // satisfy:
    // [IGNORE] The finality_update is received after the block at signature_slot was given enough time to propagate
    // through the network -- i.e. validate that one-third of finality_update.signature_slot has transpired
    // (SECONDS_PER_SLOT / INTERVALS_PER_SLOT seconds after the start of the slot, with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
    // const currentTime = computeTimeAtSlot(config, chain.clock.currentSlotWithGossipDisparity, chain.genesisTime);
    const timeAtSignatureSlot =
      computeTimeAtSlot(config, lightClientFinalityUpdate.signatureSlot, chain.genesisTime) * 1000;
    fakeClock.tick(timeAtSignatureSlot + (1 / 3) * (config.SECONDS_PER_SLOT + 1) * 1000);

    // satisfy:
    // [IGNORE] The received finality_update matches the locally computed one exactly
    chain.lightClientServer.getFinalityUpdate = () => {
      return lightClientFinalityUpdate;
    };

    expect(() => {
      validateLightClientFinalityUpdate(config, chain, lightClientFinalityUpdate);
    }).to.not.throw("Expected validateLightClientFinalityUpdate not to throw");
  });
});
