import {expect} from "chai";
import sinon from "sinon";
import {AbortController} from "abort-controller";
import {config} from "@chainsafe/lodestar-config/minimal";
import * as attestationUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/attestation";

import {AttestationCollector} from "../../../../src/sync/utils";
import {LocalClock} from "../../../../src/chain/clock/LocalClock";
import {ChainEventEmitter} from "../../../../src/chain/emitter";
import {Eth2Gossipsub, GossipType} from "../../../../src/network/gossip";
import {BeaconDb} from "../../../../src/db";
import {generateCachedState} from "../../../utils/state";
import {testLogger} from "../../../utils/logger";
import {ForkName} from "@chainsafe/lodestar-config";

describe("Attestation collector", function () {
  const sandbox = sinon.createSandbox();
  const logger = testLogger();
  beforeEach(() => {
    sandbox.useFakeTimers();
  });
  afterEach(() => {
    sandbox.restore();
  });

  it("should subscribe and collect attestations", async function () {
    const fakeGossip = sandbox.createStubInstance(Eth2Gossipsub);
    const dbStub = sandbox.createStubInstance(BeaconDb);
    const computeSubnetStub = sandbox.stub(attestationUtils, "computeSubnetForSlot");
    const emitter = new ChainEventEmitter();
    const abortController = new AbortController();
    const realClock = new LocalClock({
      config,
      emitter,
      genesisTime: Math.round(new Date().getTime() / 1000),
      signal: abortController.signal,
    });
    const collector = new AttestationCollector(config, {
      // @ts-ignore
      chain: {
        clock: realClock,
        getHeadState: () => generateCachedState(),
        getHeadForkName: () => ForkName.phase0,
        emitter,
      },
      // @ts-ignore
      network: {gossip: fakeGossip},
      db: dbStub,
      logger,
    });
    collector.start();
    computeSubnetStub.returns(10);
    const subscribed = new Promise((resolve) => {
      fakeGossip.subscribeTopic.callsFake(resolve);
    });
    collector.subscribeToCommitteeAttestations(1, 1);
    expect(
      fakeGossip.subscribeTopic.withArgs({type: GossipType.beacon_attestation, fork: ForkName.phase0, subnet: 10})
        .calledOnce
    ).to.be.true;
    sandbox.clock.tick(config.params.SECONDS_PER_SLOT * 1000);
    await subscribed;
    sandbox.clock.tick(config.params.SECONDS_PER_SLOT * 1000);
    expect(
      fakeGossip.unsubscribeTopic.withArgs({type: GossipType.beacon_attestation, fork: ForkName.phase0, subnet: 10})
        .calledOnce
    ).to.be.true;
    collector.stop();
    abortController.abort();
  });

  it("should skip if there is no duties", function () {
    const emitter = new ChainEventEmitter();
    const abortController = new AbortController();
    const realClock = new LocalClock({
      config,
      emitter,
      genesisTime: Math.round(new Date().getTime() / 1000),
      signal: abortController.signal,
    });
    const fakeGossip = sandbox.createStubInstance(Eth2Gossipsub);
    const collector = new AttestationCollector(config, {
      // @ts-ignore
      chain: {
        clock: realClock,
        getHeadState: () => generateCachedState(),
        getHeadForkName: () => ForkName.phase0,
        emitter,
      },
      // @ts-ignore
      network: {gossip: fakeGossip},
      logger,
    });
    collector.start();
    sandbox.clock.tick(config.params.SECONDS_PER_SLOT * 1000);
    expect(fakeGossip.subscribeTopic.called).to.be.false;
    collector.stop();
    abortController.abort();
  });
});
