import {expect} from "chai";
import sinon from "sinon";
import AbortController from "abort-controller";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import * as attestationUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/attestation";

import {AttestationCollector} from "../../../../src/sync/utils";
import {LocalClock} from "../../../../src/chain/clock/LocalClock";
import {ChainEventEmitter} from "../../../../src/chain/emitter";
import {Gossip} from "../../../../src/network/gossip/gossip";
import {BeaconDb} from "../../../../src/db";
import {generateState} from "../../../utils/state";
import {silentLogger} from "../../../utils/logger";

describe("Attestation collector", function () {
  const sandbox = sinon.createSandbox();
  const logger = silentLogger;

  it("should subscribe and collect attestations", async function () {
    const clock = sandbox.useFakeTimers();
    const fakeGossip = sandbox.createStubInstance(Gossip);
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
        getHeadState: () => Promise.resolve(generateState()),
        emitter,
      },
      // @ts-ignore
      network: {
        gossip: fakeGossip,
      },
      db: dbStub,
      logger,
    });
    await collector.start();
    computeSubnetStub.returns(10);
    await collector.subscribeToCommitteeAttestations(1, 1);
    expect(fakeGossip.subscribeToAttestationSubnet.withArgs(sinon.match.any, 10).calledOnce).to.be.true;
    clock.tick(config.params.SECONDS_PER_SLOT * 1000);
    await new Promise((resolve) => {
      fakeGossip.subscribeToAttestationSubnet.callsFake(resolve);
    });
    expect(fakeGossip.subscribeToAttestationSubnet.withArgs(sinon.match.any, 10, sinon.match.func).calledOnce).to.be
      .true;
    clock.tick(config.params.SECONDS_PER_SLOT * 1000);
    expect(fakeGossip.unsubscribeFromAttestationSubnet.withArgs(sinon.match.any, 10, sinon.match.func).calledOnce).to.be
      .true;
    await collector.stop();
    abortController.abort();
  });

  it("should skip if there is no duties", async function () {
    const clock = sandbox.useFakeTimers();
    const emitter = new ChainEventEmitter();
    const abortController = new AbortController();
    const realClock = new LocalClock({
      config,
      emitter,
      genesisTime: Math.round(new Date().getTime() / 1000),
      signal: abortController.signal,
    });
    const fakeGossip = sandbox.createStubInstance(Gossip);
    const collector = new AttestationCollector(config, {
      // @ts-ignore
      chain: {
        clock: realClock,
        getHeadState: () => Promise.resolve(generateState()),
        emitter,
      },
      // @ts-ignore
      network: {
        gossip: fakeGossip,
      },
      logger,
    });
    await collector.start();
    clock.tick(config.params.SECONDS_PER_SLOT * 1000);
    expect(fakeGossip.subscribeToAttestationSubnet.called).to.be.false;
    await collector.stop();
    abortController.abort();
  });
});
