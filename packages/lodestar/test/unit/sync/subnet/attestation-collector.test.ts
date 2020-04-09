import {describe, it} from "mocha";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {AttestationCollector} from "../../../../src/sync/utils/attestation-collector";
import {LocalClock} from "../../../../src/chain/clock/local/LocalClock";
import sinon from "sinon";
import {Gossip} from "../../../../src/network/gossip/gossip";
import {OpPool} from "../../../../src/opPool";
import {getCommitteeIndexSubnet} from "../../../../src/network/gossip/utils";
import { expect } from "chai";

describe("Attestation collector",function() {

    const sandbox = sinon.createSandbox();

    it("should subscribe and collect attestations", async function () {
        const clock = sandbox.useFakeTimers();
        const fakeGossip = sandbox.createStubInstance(Gossip);
        const fakeOpPool = sandbox.createStubInstance(OpPool);
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
                // @ts-ignore
                opPool: fakeOpPool
            }
        );
        await realClock.start();
        await collector.start();
        collector.subscribeToCommitteeAttestations(1, 1);
        expect(fakeGossip.subscribeToAttestationSubnet.withArgs(getCommitteeIndexSubnet(1)).calledOnce).to.be.true;
        clock.tick(config.params.SECONDS_PER_SLOT * 1000);
        expect(fakeGossip.subscribeToAttestationSubnet.withArgs(getCommitteeIndexSubnet(1), sinon.match.any).calledOnce).to.be.true;
        clock.tick(config.params.SECONDS_PER_SLOT * 1000);
        expect(fakeGossip.unsubscribeFromAttestationSubnet.withArgs(getCommitteeIndexSubnet(1), sinon.match.func).calledOnce).to.be.true;
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
    })

});