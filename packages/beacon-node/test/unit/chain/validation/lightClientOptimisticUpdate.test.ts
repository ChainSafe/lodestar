import {expect} from "chai";
import sinon from "sinon";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {altair, ssz} from "@lodestar/types";

import {computeTimeAtSlot} from "@lodestar/state-transition";
import {MockBeaconChain} from "../../../utils/mocks/chain/chain.js";
import {generateState} from "../../../utils/state.js";
import {validateLightClientOptimisticUpdate} from "../../../../src/chain/validation/lightClientOptimisticUpdate.js";
import {LightClientErrorCode} from "../../../../src/chain/errors/lightClientError.js";
import {IBeaconChain} from "../../../../src/chain/index.js";

describe("Light Client Optimistic Update validation", function () {
  let fakeClock: sinon.SinonFakeTimers;
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createChainForkConfig({
    ...defaultChainConfig,
    /* eslint-disable @typescript-eslint/naming-convention */
    ALTAIR_FORK_EPOCH: 1,
    BELLATRIX_FORK_EPOCH: 3,
    CAPELLA_FORK_EPOCH: Infinity,
  });

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
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const state = generateState({
      finalizedCheckpoint: {
        epoch: 0,
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      },
    });

    const beaconConfig = createBeaconConfig(config, state.genesisValidatorsRoot);
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
    const lightclientOptimisticUpdate: altair.LightClientOptimisticUpdate = ssz.altair.LightClientOptimisticUpdate.defaultValue();

    lightclientOptimisticUpdate.attestedHeader.beacon.slot = 2;

    const chain = mockChain();
    chain.lightClientServer.getOptimisticUpdate = () => {
      const defaultValue = ssz.altair.LightClientOptimisticUpdate.defaultValue();
      // make the local slot higher than gossiped
      defaultValue.attestedHeader.beacon.slot = lightclientOptimisticUpdate.attestedHeader.beacon.slot + 1;
      return defaultValue;
    };

    expect(() => {
      validateLightClientOptimisticUpdate(config, chain, lightclientOptimisticUpdate);
    }).to.throw(
      LightClientErrorCode.OPTIMISTIC_UPDATE_ALREADY_FORWARDED,
      "Expected LightClientErrorCode.OPTIMISTIC_UPDATE_ALREADY_FORWARDED to be thrown"
    );
  });

  it("should return invalid - optimistic update received too early", async () => {
    const lightclientOptimisticUpdate: altair.LightClientOptimisticUpdate = ssz.altair.LightClientOptimisticUpdate.defaultValue();
    lightclientOptimisticUpdate.attestedHeader.beacon.slot = 2;
    lightclientOptimisticUpdate.signatureSlot = 4;

    const chain = mockChain();
    chain.lightClientServer.getOptimisticUpdate = () => {
      const defaultValue = ssz.altair.LightClientOptimisticUpdate.defaultValue();
      defaultValue.attestedHeader.beacon.slot = 1;
      return defaultValue;
    };

    expect(() => {
      validateLightClientOptimisticUpdate(config, chain, lightclientOptimisticUpdate);
    }).to.throw(
      LightClientErrorCode.OPTIMISTIC_UPDATE_RECEIVED_TOO_EARLY,
      "Expected LightClientErrorCode.OPTIMISTIC_UPDATE_RECEIVED_TOO_EARLY to be thrown"
    );
  });

  it("should return invalid - optimistic update not matching local", async () => {
    const lightclientOptimisticUpdate: altair.LightClientOptimisticUpdate = ssz.altair.LightClientOptimisticUpdate.defaultValue();
    lightclientOptimisticUpdate.attestedHeader.beacon.slot = 42;

    const chain = mockChain();

    const timeAtSignatureSlot =
      computeTimeAtSlot(config, lightclientOptimisticUpdate.signatureSlot, chain.genesisTime) * 1000;
    fakeClock.tick(timeAtSignatureSlot + (1 / 3) * (config.SECONDS_PER_SLOT + 1) * 1000);

    // make lightclientserver return another update with different value from gossiped
    chain.lightClientServer.getOptimisticUpdate = () => {
      const defaultValue = ssz.altair.LightClientOptimisticUpdate.defaultValue();
      defaultValue.attestedHeader.beacon.slot = 1;
      return defaultValue;
    };

    expect(() => {
      validateLightClientOptimisticUpdate(config, chain, lightclientOptimisticUpdate);
    }).to.throw(
      LightClientErrorCode.OPTIMISTIC_UPDATE_NOT_MATCHING_LOCAL,
      "Expected LightClientErrorCode.OPTIMISTIC_UPDATE_NOT_MATCHING_LOCAL to be thrown"
    );
  });

  it("should return invalid - not matching local when no local optimistic update yet", async () => {
    const lightclientOptimisticUpdate: altair.LightClientOptimisticUpdate = ssz.altair.LightClientOptimisticUpdate.defaultValue();
    lightclientOptimisticUpdate.attestedHeader.beacon.slot = 42;

    const chain = mockChain();

    const timeAtSignatureSlot =
      computeTimeAtSlot(config, lightclientOptimisticUpdate.signatureSlot, chain.genesisTime) * 1000;
    fakeClock.tick(timeAtSignatureSlot + (1 / 3) * (config.SECONDS_PER_SLOT + 1) * 1000);

    // chain getOptimisticUpdate not mocked.
    // localOptimisticUpdate will be null
    // latestForwardedOptimisticSlot will be -1
    expect(() => {
      validateLightClientOptimisticUpdate(config, chain, lightclientOptimisticUpdate);
    }).to.throw(
      LightClientErrorCode.OPTIMISTIC_UPDATE_NOT_MATCHING_LOCAL,
      "Expected LightClientErrorCode.OPTIMISTIC_UPDATE_NOT_MATCHING_LOCAL to be thrown"
    );
  });

  it("should not throw for valid update", async () => {
    const lightclientOptimisticUpdate: altair.LightClientOptimisticUpdate = ssz.altair.LightClientOptimisticUpdate.defaultValue();
    const chain = mockChain();

    // satisfy:
    // No other optimistic_update with a lower or equal attested_header.beacon.slot was already forwarded on the network
    lightclientOptimisticUpdate.attestedHeader.beacon.slot = 2;

    // satisfy:
    // [IGNORE] The optimistic_update is received after the block at signature_slot was given enough time to propagate
    // through the network -- i.e. validate that one-third of optimistic_update.signature_slot has transpired
    // (SECONDS_PER_SLOT / INTERVALS_PER_SLOT seconds after the start of the slot, with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
    const timeAtSignatureSlot =
      computeTimeAtSlot(config, lightclientOptimisticUpdate.signatureSlot, chain.genesisTime) * 1000;
    fakeClock.tick(timeAtSignatureSlot + (1 / 3) * (config.SECONDS_PER_SLOT + 1) * 1000);

    // satisfy:
    // [IGNORE] The received optimistic_update matches the locally computed one exactly
    chain.lightClientServer.getOptimisticUpdate = () => {
      return lightclientOptimisticUpdate;
    };

    expect(() => {
      validateLightClientOptimisticUpdate(config, chain, lightclientOptimisticUpdate);
    }).to.not.throw("Expected validateLightclientOptimisticUpdate not to throw");
  });
});
