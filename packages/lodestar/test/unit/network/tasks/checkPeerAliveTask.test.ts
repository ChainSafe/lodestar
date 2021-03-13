import sinon, {SinonStubbedInstance} from "sinon";
import {CheckPeerAliveTask} from "../../../../src/network/tasks/checkPeerAliveTask";
import {INetwork, IReqResp, Network} from "../../../../src/network";
import {ReqResp} from "../../../../src/network/reqresp/reqResp";
import {Logger} from "@chainsafe/lodestar-utils";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {expect} from "chai";
import PeerId from "peer-id";
import {getStubbedMetadataStore, StubbedIPeerMetadataStore} from "../../../utils/peer";

describe("CheckPeerAliveTask", function () {
  let networkStub: SinonStubbedInstance<INetwork>;
  let reqRespStub: SinonStubbedInstance<IReqResp>;
  let peerMetadataStub: StubbedIPeerMetadataStore;
  let task: CheckPeerAliveTask;
  let peerId: PeerId;

  beforeEach(async () => {
    networkStub = sinon.createStubInstance(Network);
    reqRespStub = sinon.createStubInstance(ReqResp);
    networkStub.reqResp = reqRespStub;
    peerMetadataStub = getStubbedMetadataStore();
    networkStub.peerMetadata = peerMetadataStub;
    task = new CheckPeerAliveTask(config, {
      logger: new Logger(),
      network: networkStub,
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

    // expect(networkStub.disconnect.calledOnce).to.be.true;
    expect(reqRespStub.metadata.called).to.be.false;
  });

  it("ping successfully, return same sequence number", async () => {
    reqRespStub.ping.resolves(BigInt(1));
    peerMetadataStub.metadata.get.withArgs(peerId).returns({
      seqNumber: BigInt(1),
      attnets: Array(64).fill(true),
    });
    await task.run();

    expect(networkStub.disconnect.called).to.be.false;
    expect(reqRespStub.metadata.called).to.be.false;
  });

  it("ping successfully, return bigger sequence number", async () => {
    reqRespStub.ping.resolves(BigInt(10));
    peerMetadataStub.metadata.get.withArgs(peerId).returns({
      seqNumber: BigInt(1),
      attnets: Array(64).fill(true),
    });
    await task.run();

    expect(networkStub.disconnect.called).to.be.false;
    expect(reqRespStub.metadata.calledOnce).to.be.true;
  });
});
