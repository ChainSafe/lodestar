import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../src/api";
import {produceAggregatedAttestation} from "../../../../../src/api/rest/controllers/validator";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {silentLogger} from "../../../../utils/logger";
import {StubbedApi} from "../../../../utils/stub/api";
import {urlJoin} from "../utils";
import {VALIDATOR_PREFIX} from "./index.test";

describe("rest - validator - produceAggregatedAttestation", function () {
  let restApi: RestApi;
  let api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi();
    restApi = await RestApi.init(
      {
        api: [ApiNamespace.VALIDATOR],
        cors: "*",
        enabled: true,
        host: "127.0.0.1",
        port: 0,
      },
      {
        config,
        logger: silentLogger,
        api,
      }
    );
  });

  afterEach(async function () {
    await restApi.close();
  });

  it("should succeed", async function () {
    const root = config.types.Root.defaultValue();
    api.validator.getAggregatedAttestation.resolves(generateEmptyAttestation());
    const response = await supertest(restApi.server.server)
      .get(urlJoin(VALIDATOR_PREFIX, produceAggregatedAttestation.url))
      .query({
        // eslint-disable-next-line @typescript-eslint/camelcase
        attestation_data_root: toHexString(root),
        slot: 0,
      })
      .expect(200);
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.not.be.undefined;
    expect(api.validator.getAggregatedAttestation.withArgs(root, 0).calledOnce).to.be.true;
  });

  it("missing param", async function () {
    api.validator.getAggregatedAttestation.resolves();
    await supertest(restApi.server.server)
      .get(urlJoin(VALIDATOR_PREFIX, produceAggregatedAttestation.url))
      .query({
        slot: 0,
      })
      .expect(400);
    expect(api.validator.getAggregatedAttestation.notCalled).to.be.true;
  });
});
