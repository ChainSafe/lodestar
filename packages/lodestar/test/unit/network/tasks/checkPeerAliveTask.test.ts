import sinon, {SinonStubbedInstance} from "sinon";
import {CheckPeerAliveTask} from "../../../../src/network/tasks/checkPeerAliveTask";
import {INetwork, IReqResp, Libp2pNetwork} from "../../../../src/network";
import {ReputationStore} from "../../../../src/sync/IReputation";
import {ReqResp} from "../../../../src/network/reqResp";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {expect} from "chai";
import PeerId from "peer-id";

describe("CheckPeerAliveTask", function () {
  let networkStub: SinonStubbedInstance<INetwork>;
  let reqRespStub: SinonStubbedInstance<IReqResp>;
  let reps: ReputationStore;
  let task: CheckPeerAliveTask;
  let peerId: PeerId;
  beforeEach(async () => {
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    reqRespStub = sinon.createStubInstance(ReqResp);
    networkStub.reqResp = reqRespStub;
    reps = new ReputationStore();
    task = new CheckPeerAliveTask(config, {
      logger: new WinstonLogger(),
      network: networkStub,
      reps,
    });
    // @ts-ignore
    networkStub.metadata = {
      seqNumber: BigInt(1),
    };
    peerId = await PeerId.create();
    networkStub.getPeers.returns([{id: peerId} as LibP2p.Peer]);
  });

  afterEach(() => {
    sinon.restore();
  });

  it("cannot ping, should disconnect", async () => {
    reqRespStub.ping.throws("Error from unit test");
    await task.run();
    expect(networkStub.disconnect.calledOnce).to.be.true;
    expect(reqRespStub.metadata.called).to.be.false;
  });

  it("ping returns null, should disconnect", async () => {
    reqRespStub.ping.resolves(null);
    await task.run();
    expect(networkStub.disconnect.calledOnce).to.be.true;
    expect(reqRespStub.metadata.called).to.be.false;
  });

  it("ping successfully, return same sequence number", async () => {
    reqRespStub.ping.resolves(BigInt(1));
    reps.getFromPeerId(peerId).latestMetadata = {
      seqNumber: BigInt(1),
      attnets: Array(64).fill(true),
    };
    await task.run();
    expect(networkStub.disconnect.called).to.be.false;
    expect(reqRespStub.metadata.called).to.be.false;
  });

  it("ping successfully, return bigger sequence number", async () => {
    reqRespStub.ping.resolves(BigInt(10));
    reps.getFromPeerId(peerId).latestMetadata = {
      seqNumber: BigInt(1),
      attnets: Array(64).fill(true),
    };
    await task.run();
    expect(networkStub.disconnect.called).to.be.false;
    expect(reqRespStub.metadata.calledOnce).to.be.true;
  });
});
