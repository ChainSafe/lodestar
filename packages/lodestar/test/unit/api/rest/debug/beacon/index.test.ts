import {config} from "@chainsafe/lodestar-config/minimal";
import {SinonStubbedInstance} from "sinon";
import {RestApi, ApiNamespace} from "../../../../../../src/api";
import {DebugBeaconApi} from "../../../../../../src/api/impl/debug/beacon";
import {testLogger} from "../../../../../utils/logger";
import {StubbedApi} from "../../../../../utils/stub/api";

beforeEach(async function () {
  this.api = new StubbedApi();
  this.restApi = await RestApi.init(
    {
      api: [ApiNamespace.DEBUG],
      cors: "*",
      enabled: true,
      host: "127.0.0.1",
      port: 0,
    },
    {
      config,
      logger: testLogger(),
      api: this.api,
    }
  );
  this.debugBeaconStub = this.api.debug.beacon as SinonStubbedInstance<DebugBeaconApi>;
});

afterEach(async function () {
  await this.restApi.close();
});
