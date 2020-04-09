import {afterEach, beforeEach, describe, it} from "mocha";
import {FastSync, IInitialSyncModules} from "../../../../src/sync/initial";
import sinon from "sinon";
import {BeaconChain} from "../../../../src/chain";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {config} from "@chainsafe/lodestar-config/src/presets/minimal";
import {Libp2pNetwork} from "../../../../src/network";
import {IReputation, ReputationStore} from "../../../../src/sync/IReputation";
import {ISyncOptions} from "../../../../src/sync/options";
import {expect} from "chai";
import * as syncUtils from "../../../../src/sync/utils/sync";
import * as blockSyncUtils from "../../../../src/sync/utils/blocks";
import PeerInfo from "peer-info";
import {generateState} from "../../../utils/state";
import {generateEmptyBlock} from "../../../utils/block";

describe("fast sync", function () {

  const sandbox = sinon.createSandbox();

  let modules: IInitialSyncModules,
    defaultOpts: ISyncOptions,
    getTargetEpochStub: any,
    getBlockRangeStub: any,
    isValidHeaderChainStub: any
  ;

  beforeEach(function () {
    modules = {
      chain: sandbox.createStubInstance(BeaconChain),
      logger: sandbox.createStubInstance(WinstonLogger),
      config,
      network: sandbox.createStubInstance(Libp2pNetwork),
      peers: [],
      // @ts-ignore
      reps: sandbox.createStubInstance(ReputationStore)
    };
    defaultOpts = {
      blockPerChunk: 2
    };
    getTargetEpochStub = sandbox.stub(syncUtils, "getInitalSyncTargetEpoch");
    isValidHeaderChainStub = sandbox.stub(syncUtils, "isValidChainOfBlocks");
    getBlockRangeStub = sandbox.stub(blockSyncUtils, "getBlockRange");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("no peers - exit", async function () {
    const sync = new FastSync(defaultOpts, modules);
    await sync.start();
    // @ts-ignore
    expect(modules.logger.error.calledOnce).to.be.true;
  });

  it("chain not initialized", async function () {
    const sync = new FastSync(
      defaultOpts,
      {
        ...modules,
        peers: [sinon.createStubInstance(PeerInfo)]
      }
    );
    // @ts-ignore
    modules.chain.isInitialized.returns(false);
    const eventSpy = sinon.spy();
    sync.once("sync:completed", eventSpy);
    await sync.start();
    expect(eventSpy.called).to.be.true;
  });

  it("already synced - same epoch", async function () {
    const peer = sinon.createStubInstance(PeerInfo);
    const sync = new FastSync(
      defaultOpts,
      {
        ...modules,
        peers: [peer]
      }
    );
    // @ts-ignore
    modules.chain.isInitialized.returns(true);
    const chainCheckPoint = {root: Buffer.alloc(32, 1), epoch: 3};
    // @ts-ignore
    modules.reps.getFromPeerInfo.returns({latestStatus: {finalizedEpoch: 3, finalizedRoot: chainCheckPoint.root}});
    // @ts-ignore
    modules.chain.getHeadState.resolves(generateState({currentJustifiedCheckpoint: chainCheckPoint}))
    getTargetEpochStub.returns(3);
    const eventSpy = sinon.spy();
    sync.once("sync:completed", eventSpy);
    await sync.start();
    expect(eventSpy.calledOnceWith(chainCheckPoint)).to.be.true;
    //@ts-ignore
    expect(modules.chain.removeListener.calledOnceWith("processedCheckpoint", sinon.match.any)).to.be.true;
  });

  it("already synced - higher epoch epoch", async function () {
    const peer = sinon.createStubInstance(PeerInfo);
    const sync = new FastSync(
      defaultOpts,
      {
        ...modules,
        peers: [peer]
      }
    );

    // @ts-ignore
    modules.chain.isInitialized.returns(true);
    const chainCheckPoint = {root: Buffer.alloc(32, 1), epoch: 4};
    // @ts-ignore
    modules.reps.getFromPeerInfo.returns({latestStatus: {finalizedEpoch: 3, finalizedRoot: chainCheckPoint.root}});
    // @ts-ignore
    modules.chain.getHeadState.resolves(generateState({currentJustifiedCheckpoint: chainCheckPoint}));
    getTargetEpochStub.returns(3);
    const eventSpy = sinon.spy();
    sync.once("sync:completed", eventSpy);
    await sync.start();
    expect(eventSpy.calledOnceWith(chainCheckPoint)).to.be.true;
    //@ts-ignore
    expect(modules.chain.removeListener.calledOnceWith("processedCheckpoint", sinon.match.any)).to.be.true;
  });

  it("happy path", async function () {
    const peer = sinon.createStubInstance(PeerInfo);
    const sync = new FastSync(
      defaultOpts,
      {
        ...modules,
        peers: [peer]
      }
    );
    // @ts-ignore
    modules.chain.isInitialized.returns(true);
    const chainCheckPoint = {root: Buffer.alloc(32, 1), epoch: 4};
    // @ts-ignore
    modules.chain.getHeadState.resolves(generateState({currentJustifiedCheckpoint: chainCheckPoint}));
    // @ts-ignore
    modules.reps.getFromPeerInfo.returns({latestStatus: {finalizedEpoch: 3, finalizedRoot: chainCheckPoint.root}});
    // @ts-ignore
    modules.reps.getFromPeerInfo.returns({} as unknown as IReputation);
    getTargetEpochStub.returns(5);
    getBlockRangeStub.resolves([generateEmptyBlock(), generateEmptyBlock()]);
    isValidHeaderChainStub.returns(true);
    const eventSpy = sinon.spy();
    sync.on("sync:checkpoint", eventSpy);
    await sync.start();
    expect(eventSpy.withArgs(5).calledOnce).to.be.true;
  });

  it("invalid header chain", async function () {
    const peer = sinon.createStubInstance(PeerInfo);
    const sync = new FastSync(
      defaultOpts,
      {
        ...modules,
        peers: [peer]
      }
    );
    // @ts-ignore
    modules.chain.isInitialized.returns(true);
    const chainCheckPoint = {root: Buffer.alloc(32, 1), epoch: 4};
    // @ts-ignore
    modules.chain.getHeadState.resolves(generateState({currentJustifiedCheckpoint: chainCheckPoint}));
    // @ts-ignore
    modules.reps.getFromPeerInfo.returns({} as unknown as IReputation);
    getTargetEpochStub.returns(5);
    getBlockRangeStub.resolves([generateEmptyBlock(), generateEmptyBlock()]);
    isValidHeaderChainStub.onFirstCall().returns(false);
    isValidHeaderChainStub.onSecondCall().returns(true);
    const eventSpy = sinon.spy();
    sync.on("sync:checkpoint", eventSpy);
    await sync.start();
    expect(eventSpy.withArgs(5).calledOnce).to.be.true;
  });

});
