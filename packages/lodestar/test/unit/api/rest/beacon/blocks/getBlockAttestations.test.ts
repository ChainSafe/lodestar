import {expect} from "chai";
import supertest from "supertest";

import {List} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";

import {getBlockAttestations} from "../../../../../../src/api/rest/controllers/beacon/blocks";
import {generateSignedBlock} from "../../../../../utils/block";
import {generateEmptyAttestation} from "../../../../../utils/attestation";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../../index.test";

describe("rest - beacon - getBlockAttestations", function () {
  it("should succeed", async function () {
    this.test?.ctx?.beaconBlocksStub.getBlock.withArgs("head").resolves(
      generateSignedBlock({
        message: {
          body: {
            attestations: [generateEmptyAttestation(), generateEmptyAttestation()] as List<phase0.Attestation>,
          },
        },
      })
    );
    const response = await supertest(this.test?.ctx?.restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockAttestations.url.replace(":blockId", "head")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.length).to.equal(2);
  });

  it("should not found block", async function () {
    this.test?.ctx?.beaconBlocksStub.getBlock.withArgs("4").resolves(null);
    await supertest(this.test?.ctx?.restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockAttestations.url.replace(":blockId", "4")))
      .expect(404);
  });

  it("should fail validation", async function () {
    this.test?.ctx?.beaconBlocksStub.getBlock.throws(new Error("Invalid block id"));
    await supertest(this.test?.ctx?.restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockAttestations.url.replace(":blockId", "abc")))
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
