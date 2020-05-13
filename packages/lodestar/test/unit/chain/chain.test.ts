import chainOpts from "../../../src/chain/options";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import sinon from "sinon";
import {expect} from "chai";
import {IEth1Notifier} from "../../../src/eth1";
import {InteropEth1Notifier} from "../../../src/eth1/impl/interop";
import {WinstonLogger, bytesToInt} from "@chainsafe/lodestar-utils";
import {BeaconMetrics} from "../../../src/metrics";
import {IBeaconChain, BeaconChain, StatefulDagLMDGHOST} from "../../../src/chain";
import {generateState} from "../../utils/state";
import {StubbedBeaconDb} from "../../utils/stub";

describe("BeaconChain", function() {
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb, eth1: IEth1Notifier, metrics: any, forkChoice: any;
  const logger = new WinstonLogger();
  let chain: IBeaconChain;

  beforeEach(async () => {
    dbStub = new StubbedBeaconDb(sandbox, config);
    eth1 = new InteropEth1Notifier();
    metrics = sandbox.createStubInstance(BeaconMetrics);
    forkChoice = sandbox.createStubInstance(StatefulDagLMDGHOST);
    const state = generateState();
    dbStub.stateCache.get.resolves(state as any);
    dbStub.stateArchive.lastValue.resolves(state as any);
    chain = new BeaconChain(chainOpts, {config, db: dbStub, eth1, logger, metrics, forkChoice});
    await chain.start();
  });

  afterEach(async () => {
    await chain.stop();
    sandbox.restore();
  });

  describe("getENRForkID", () => {
    it("should get enr fork id if not found next fork", async () => {
      forkChoice.headStateRoot.returns(Buffer.alloc(0));
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
          previousVersion: bytesToInt(config.params.GENESIS_FORK_VERSION)
        }
      ];
      forkChoice.headStateRoot.returns(Buffer.alloc(0));
      const enrForkID = await chain.getENRForkID();
      expect(config.types.Version.equals(enrForkID.nextForkVersion, Buffer.from([2, 0, 0, 0])));
      expect(enrForkID.nextForkEpoch === 100);
      // it's possible to serialize enr fork id
      config.types.ENRForkID.hashTreeRoot(enrForkID);
      config.params.ALL_FORKS = undefined;
    });
  });

  describe("forkDigestChanged event", () => {
    it("should should receive forkDigest event", async () => {
      const spy = sinon.spy();
      const received = new Promise((resolve) => {
        chain.on("forkDigest", () => {
          spy();
          resolve();
        });
      });
      chain.emit("forkDigestChanged");
      await received;
      expect(spy.callCount).to.be.equal(1);
    });
  });


});
