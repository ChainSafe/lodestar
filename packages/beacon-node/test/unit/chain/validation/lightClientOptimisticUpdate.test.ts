import {createIBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {altair, ssz} from "@lodestar/types";

import {generateEmptySignedBlock} from "../../../utils/block.js";
import {MockBeaconChain} from "../../../utils/mocks/chain/chain.js";
import {generateState} from "../../../utils/state.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {validateLightClientOptimisticUpdate} from "../../../../src/chain/validation/lightClientOptimisticUpdate.js";
import {LightClientErrorCode} from "../../../../src/chain/errors/lightClientError.js";
import {IBeaconChain} from "../../../../src/chain/index.js";

describe("Light Client Optimistic Update validation", function () {
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

  it("should return invalid - optimistic update already forwarded", async () => {
    //No other optimistic_update with a lower or equal attested_header.slot was already forwarded on the network
    const lightclientOptimisticUpdate: altair.LightClientOptimisticUpdate = ssz.altair.LightClientOptimisticUpdate.defaultValue();

    await expectRejectedWithLodestarError(
      validateLightClientOptimisticUpdate(config, mockChain(), lightclientOptimisticUpdate),
      LightClientErrorCode.OPTIMISTIC_UPDATE_ALREADY_FORWARDED
    );
  });

  it("should return invalid - optimistic update received too early", async () => {
    //No other optimistic_update with a lower or equal attested_header.slot was already forwarded on the network
    const lightclientOptimisticUpdate: altair.LightClientOptimisticUpdate = ssz.altair.LightClientOptimisticUpdate.defaultValue();
    lightclientOptimisticUpdate.attestedHeader.slot = 2;
    lightclientOptimisticUpdate.signatureSlot = 4;

    const chain = mockChain();
    chain.lightClientServer.latestForwardedOptimisticSlot = 1;

    await expectRejectedWithLodestarError(
      validateLightClientOptimisticUpdate(config, chain, lightclientOptimisticUpdate),
      LightClientErrorCode.OPTIMISTIC_UPDATE_RECEIVED_TOO_EARLY
    );
  });

  it("should return invalid - optimistic update not matching local", async () => {
    //No other optimistic_update with a lower or equal attested_header.slot was already forwarded on the network
    const lightclientOptimisticUpdate: altair.LightClientOptimisticUpdate = ssz.altair.LightClientOptimisticUpdate.defaultValue();
    lightclientOptimisticUpdate.attestedHeader.slot = 2;

    const chain = mockChain();
    chain.lightClientServer.latestForwardedOptimisticSlot = 1;

    // make lightclientserver return another update
    chain.lightClientServer.getOptimisticUpdate = async () => {
      return ssz.altair.LightClientOptimisticUpdate.defaultValue();
    };

    await expectRejectedWithLodestarError(
      validateLightClientOptimisticUpdate(config, chain, lightclientOptimisticUpdate),
      LightClientErrorCode.NOT_MATCHING_LOCAL
    );
  });
});
