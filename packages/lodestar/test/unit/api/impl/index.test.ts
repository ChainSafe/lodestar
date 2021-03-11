import {config} from "@chainsafe/lodestar-config/minimal";
import {SinonSandbox, SinonStubbedInstance} from "sinon";
import sinon from "sinon";
import {BeaconBlockApi} from "../../../../src/api/impl/beacon/blocks";
import {ForkChoice, BeaconChain} from "../../../../src/chain";
import {Network} from "../../../../src/network";
import {BeaconSync} from "../../../../src/sync";
import {StubbedBeaconDb} from "../../../utils/stub";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export class ApiImplTestServer {
  public sandbox: SinonSandbox;
  public forkChoiceStub: SinonStubbedInstance<ForkChoice>;
  public chainStub: SinonStubbedInstance<BeaconChain>;
  public syncStub: SinonStubbedInstance<BeaconSync>;
  public dbStub: StubbedBeaconDb;
  public networkStub: SinonStubbedInstance<Network>;
  public blockApi: BeaconBlockApi;
  public config: IBeaconConfig;

  constructor() {
    this.sandbox = sinon.createSandbox();
    this.forkChoiceStub = sinon.createStubInstance(ForkChoice);
    this.chainStub = sinon.createStubInstance(BeaconChain);
    this.syncStub = sinon.createStubInstance(BeaconSync);
    this.chainStub.forkChoice = this.forkChoiceStub;
    this.dbStub = new StubbedBeaconDb(sinon, config);
    this.networkStub = sinon.createStubInstance(Network);
    this.config = config;

    this.blockApi = new BeaconBlockApi(
      {},
      {
        chain: this.chainStub,
        config,
        db: this.dbStub,
        network: this.networkStub,
        sync: this.syncStub,
      }
    );
  }
}

export function setupApiImplTestServer(): ApiImplTestServer {
  return new ApiImplTestServer();
}
