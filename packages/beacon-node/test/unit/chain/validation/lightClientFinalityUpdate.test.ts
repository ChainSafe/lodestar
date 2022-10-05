import {expect} from "chai";
import {createIBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {altair, ssz} from "@lodestar/types";

import {generateEmptySignedBlock} from "../../../utils/block.js";
import {MockBeaconChain} from "../../../utils/mocks/chain/chain.js";
import {generateState} from "../../../utils/state.js";
import {validateLightClientFinalityUpdate} from "../../../../src/chain/validation/lightClientFinalityUpdate.js";
import {LightClientErrorCode} from "../../../../src/chain/errors/lightClientError.js";
import {IBeaconChain} from "../../../../src/chain/index.js";

describe("Light Client Finality Update validation", function () {
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
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

    expect(() => {
      validateLightClientFinalityUpdate(config, mockChain(), lightclientFinalityUpdate);
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
    chain.lightClientServer.latestForwardedFinalitySlot = 1;

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

    const chain = mockChain();
    chain.lightClientServer.latestForwardedFinalitySlot = 1;

    // make lightclientserver return another update
    chain.lightClientServer.getFinalityUpdate = () => {
      return ssz.altair.LightClientFinalityUpdate.defaultValue();
    };

    expect(() => {
      validateLightClientFinalityUpdate(config, chain, lightClientFinalityUpdate);
    }).to.throw(
      LightClientErrorCode.FINALITY_UPDATE_NOT_MATCHING_LOCAL,
      "Expected LightClientErrorCode.FINALITY_UPDATE_NOT_MATCHING_LOCAL to be thrown"
    );
  });
});
