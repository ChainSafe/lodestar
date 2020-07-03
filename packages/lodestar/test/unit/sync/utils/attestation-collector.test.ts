import {describe, it} from "mocha";
import {expect} from "chai";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

import {AttestationCollector} from "../../../../src/sync/utils";
import {LocalClock} from "../../../../src/chain/clock/local/LocalClock";
import {Gossip} from "../../../../src/network/gossip/gossip";
import {BeaconDb} from "../../../../src/db";
import * as attestationUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/attestation";
import {generateState} from "../../../utils/state";

describe("Attestation collector",function() {

  const sandbox = sinon.createSandbox();

  it("should subscribe and collect attestations", async function () {
    const clock = sandbox.useFakeTimers();
    const fakeGossip = sandbox.createStubInstance(Gossip);
    const dbStub = sandbox.createStubInstance(BeaconDb);
    const computeSubnetStub = sandbox.stub(attestationUtils, "computeSubnetForSlot");
    const realClock = new LocalClock(config, Math.round(new Date().getTime() /1000));
    const collector = new AttestationCollector(
      config,
      {
        // @ts-ignore
        chain: {
          clock: realClock,
          getHeadState: () => Promise.resolve(generateState()),
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
    computeSubnetStub.returns(10);
    await collector.subscribeToCommitteeAttestations(1, 1);
    expect(
      fakeGossip.subscribeToAttestationSubnet.withArgs(sinon.match.any, 10).calledOnce
    ).to.be.true;
    clock.tick(config.params.SECONDS_PER_SLOT * 1000);
    await new Promise((resolve) => {
      fakeGossip.subscribeToAttestationSubnet.callsFake(resolve);
    });
    expect(
      fakeGossip.subscribeToAttestationSubnet.withArgs(
        sinon.match.any, 10, sinon.match.func
      ).calledOnce
    ).to.be.true;
    clock.tick(config.params.SECONDS_PER_SLOT * 1000);
    expect(
      fakeGossip.unsubscribeFromAttestationSubnet.withArgs(
        sinon.match.any, 10, sinon.match.func
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
          clock: realClock,
          getHeadState: () => Promise.resolve(generateState())
        },
        // @ts-ignore
        network: {
          gossip: fakeGossip
        },
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
