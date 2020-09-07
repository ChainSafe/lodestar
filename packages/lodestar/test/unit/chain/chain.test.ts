import chainOpts from "../../../src/chain/options";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStub} from "sinon";
import {expect, assert} from "chai";
import {IEth1Provider, Eth1Provider} from "../../../src/eth1";
import eth1Options from "../../../src/eth1/options";
import {bytesToInt, WinstonLogger} from "@chainsafe/lodestar-utils";
import {BeaconMetrics} from "../../../src/metrics";
import {BeaconChain, IBeaconChain} from "../../../src/chain";
import {generateState} from "../../utils/state";
import {StubbedBeaconDb} from "../../utils/stub";
import {generateValidators} from "../../utils/validator";

import {EpochContext, ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeBacked} from "@chainsafe/ssz";
import {BeaconState} from "@chainsafe/lodestar-types";
import {initBLS} from "@chainsafe/bls";
import {generateEmptySignedBlock} from "../../utils/block";
import * as processBlock from "../../../src/chain/blocks/process";

describe("BeaconChain", function () {
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb, eth1Provider: IEth1Provider, metrics: any;
  let runStateTransitionStub: SinonStub;
  const logger = new WinstonLogger();
  let chain: IBeaconChain;

  beforeEach(async () => {
    await initBLS();
    dbStub = new StubbedBeaconDb(sandbox);
    eth1Provider = new Eth1Provider(config, eth1Options);
    metrics = new BeaconMetrics({enabled: false} as any, {logger});
    runStateTransitionStub = sandbox.stub(processBlock, "runStateTransition");
    const state: BeaconState = generateState();
    state.validators = generateValidators(5, {activationEpoch: 0});
    dbStub.stateCache.get.resolves({state: state as TreeBacked<BeaconState>, epochCtx: new EpochContext(config)});
    dbStub.stateArchive.lastValue.resolves(state as any);
    chain = new BeaconChain(chainOpts, {config, db: dbStub, eth1Provider, logger, metrics});
    await chain.start();
  });

  afterEach(async () => {
    await chain.stop();
    sandbox.restore();
  });

  describe("getENRForkID", () => {
    it("should get enr fork id if not found next fork", async () => {
      chain.forkChoice.headStateRoot = () => Buffer.alloc(0);
      const enrForkID = await chain.getENRForkID();
      expect(config.types.Version.equals(enrForkID.nextForkVersion, Buffer.from([255, 255, 255, 255])));
      expect(enrForkID.nextForkEpoch === Number.MAX_SAFE_INTEGER);
      // it's possible to serialize enr fork id
      config.types.ENRForkID.hashTreeRoot(enrForkID);
    });

    it("should get enr fork id if found next fork", async () => {
      config.params.ALL_FORKS = [
        {
          currentVersion: 2,
          epoch: 100,
          previousVersion: bytesToInt(config.params.GENESIS_FORK_VERSION),
        },
      ];
      chain.forkChoice.headStateRoot = () => Buffer.alloc(0);
      const enrForkID = await chain.getENRForkID();
      expect(config.types.Version.equals(enrForkID.nextForkVersion, Buffer.from([2, 0, 0, 0])));
      expect(enrForkID.nextForkEpoch === 100);
      // it's possible to serialize enr fork id
      config.types.ENRForkID.hashTreeRoot(enrForkID);
      config.params.ALL_FORKS = undefined!;
    });
  });

  describe("forkVersion event", () => {
    it("should should receive forkDigest event", async () => {
      chain.forkChoice.headStateRoot = () => Buffer.alloc(0);
      const spy = sinon.spy();
      const received = new Promise((resolve) => {
        chain.emitter.on("forkDigest", () => {
          spy();
          resolve();
        });
      });
      chain.emitter.emit("forkVersion");
      await received;
      expect(spy.callCount).to.be.equal(1);
    });
  });

  describe("getState", () => {
    it("should get state from cache", async () => {
      const state = await chain.getState(ZERO_HASH);
      expect(!!state).to.be.true;
      expect(dbStub.checkpointStateCache.getStateRootAncestors.calledOnce).to.be.false;
    });

    it("should call checkpointStateCache and throw error", async () => {
      dbStub.stateCache.get.resolves(null);
      try {
        await chain.getState(ZERO_HASH);
        assert.fail("Expect error thrown");
      } catch (err) {
        expect(dbStub.checkpointStateCache.getStateRootAncestors.calledOnce).to.be.true;
      }
    });

    it("should replay blocks to create state", async () => {
      dbStub.stateCache.get.resolves(null);
      dbStub.checkpointStateCache.getStateRootAncestors.resolves([ZERO_HASH, ZERO_HASH]);
      const state1 = generateState();
      const epochContext1 = new EpochContext(config);
      dbStub.checkpointStateCache.get.resolves({
        state: state1,
        epochCtx: epochContext1,
      });
      chain.forkChoice.getBlockSummariesByAncestorBlockRoot = () => [
        {
          blockRoot: ZERO_HASH,
          parentRoot: ZERO_HASH,
          stateRoot: ZERO_HASH,
          slot: 0,
          finalizedCheckpoint: {epoch: 0, root: ZERO_HASH},
          justifiedCheckpoint: {epoch: 0, root: ZERO_HASH},
        },
      ];
      dbStub.block.get.resolves(generateEmptySignedBlock());
      runStateTransitionStub.resolves({
        state: state1,
        epoch: epochContext1,
      });
      await chain.getState(ZERO_HASH);
      expect(runStateTransitionStub.calledOnce).to.be.true;
    });
  });
});
