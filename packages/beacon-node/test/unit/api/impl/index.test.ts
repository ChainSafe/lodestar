import {SinonSandbox, SinonStubbedInstance} from "sinon";
import sinon from "sinon";
import {config} from "@lodestar/config/default";
import {ForkChoice} from "@lodestar/fork-choice";
import {IChainForkConfig} from "@lodestar/config";
import {getBeaconBlockApi} from "../../../../src/api/impl/beacon/blocks/index.js";
import {BeaconChain} from "../../../../src/chain/index.js";
import {Network} from "../../../../src/network/index.js";
import {BeaconSync} from "../../../../src/sync/index.js";
import {StubbedBeaconDb} from "../../../utils/stub/index.js";

export type ApiImplTestModules = {
  sandbox: SinonSandbox;
  forkChoiceStub: SinonStubbedInstance<ForkChoice>;
  chainStub: SinonStubbedInstance<BeaconChain>;
  syncStub: SinonStubbedInstance<BeaconSync>;
  dbStub: StubbedBeaconDb;
  networkStub: SinonStubbedInstance<Network>;
  blockApi: ReturnType<typeof getBeaconBlockApi>;
  config: IChainForkConfig;
};

export function setupApiImplTestServer(): ApiImplTestModules {
  const sandbox = sinon.createSandbox();
  const forkChoiceStub = sinon.createStubInstance(ForkChoice);
  const chainStub = sinon.createStubInstance(BeaconChain);
  const syncStub = sinon.createStubInstance(BeaconSync);
  const dbStub = new StubbedBeaconDb(config);
  const networkStub = sinon.createStubInstance(Network);
  const blockApi = getBeaconBlockApi({
    chain: chainStub,
    config,
    db: dbStub,
    network: networkStub,
    metrics: null,
  });
  chainStub.forkChoice = forkChoiceStub;
  return {
    sandbox,
    forkChoiceStub,
    chainStub,
    syncStub,
    dbStub,
    networkStub,
    blockApi,
    config,
  };
}
