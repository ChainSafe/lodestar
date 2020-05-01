import {describe, it} from "mocha";
import {expect} from "chai";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

import {AttestationCollector} from "../../../../src/sync/utils";
import {LocalClock} from "../../../../src/chain/clock/local/LocalClock";
import {Gossip} from "../../../../src/network/gossip/gossip";
import {getCommitteeIndexSubnet} from "../../../../src/network/gossip/utils";
import {BeaconDb} from "../../../../src/db";

describe("Attestation collector",function() {

  const sandbox = sinon.createSandbox();

  it("should subscribe and collect attestations", async function () {
    const clock = sandbox.useFakeTimers();
    const fakeGossip = sandbox.createStubInstance(Gossip);
    const dbStub = sandbox.createStubInstance(BeaconDb);
    const realClock = new LocalClock(config, Math.round(new Date().getTime() /1000));
    const collector = new AttestationCollector(
      config,
      {
        // @ts-ignore
        chain: {
          clock: realClock
        },
        // @ts-ignore
        network: {
          gossip: fakeGossip
        },
        db: dbStub,
      }
    );
    await realClock.start();
    await collector.start();
    collector.subscribeToCommitteeAttestations(1, 1);
    expect(
      fakeGossip.subscribeToAttestationSubnet.withArgs(sinon.match.any, getCommitteeIndexSubnet(1)).calledOnce
    ).to.be.true;
    clock.tick(config.params.SECONDS_PER_SLOT * 1000);
    expect(
      fakeGossip.subscribeToAttestationSubnet.withArgs(
        sinon.match.any, getCommitteeIndexSubnet(1), sinon.match.any
      ).calledOnce
    ).to.be.true;
    clock.tick(config.params.SECONDS_PER_SLOT * 1000);
    expect(
      fakeGossip.unsubscribeFromAttestationSubnet.withArgs(
        sinon.match.any, getCommitteeIndexSubnet(1), sinon.match.func
      ).calledOnce
    ).to.be.true;
    await collector.stop();
    await realClock.stop();
  });

  it("should skip if there is no duties", async function () {
    const clock = sandbox.useFakeTimers();
    const realClock = new LocalClock(config, Math.round(new Date().getTime() /1000));
    const fakeGossip = sandbox.createStubInstance(Gossip);
    const collector = new AttestationCollector(
      config,
      {
        // @ts-ignore
        chain: {
          clock: realClock
        },
        // @ts-ignore
        network: {
          gossip: fakeGossip
        },
        // @ts-ignore
        opPool: null
      }
    );
    await realClock.start();
    await collector.start();
    clock.tick(config.params.SECONDS_PER_SLOT * 1000);
    expect(fakeGossip.subscribeToAttestationSubnet.called).to.be.false;
    await collector.stop();
    await realClock.stop();
  });

});
