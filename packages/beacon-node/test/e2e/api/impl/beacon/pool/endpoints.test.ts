import {describe, beforeAll, afterAll, it, expect} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {Api, getClient} from "@lodestar/api";
import {ssz} from "@lodestar/types";
import {LogLevel, testLogger} from "../../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../../utils/node/beacon.js";
import {BeaconNode} from "../../../../../../src/node/nodejs.js";

describe("beacon pool api", function () {
  const restPort = 9596;
  const config = createBeaconConfig(chainConfigDef, Buffer.alloc(32, 0xaa));
  const validatorCount = 512;

  let bn: BeaconNode;
  let client: Api["beacon"];

  beforeAll(async () => {
    bn = await getDevBeaconNode({
      params: chainConfigDef,
      options: {
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true},
        api: {
          rest: {
            enabled: true,
            port: restPort,
          },
        },
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount,
      logger: testLogger("Node-A", {level: LogLevel.info}),
    });
    client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).beacon;
  });

  afterAll(async () => {
    await bn.close();
  });

  describe("submitPoolAttestations", () => {
    it("should return correctly formatted errors responses", async () => {
      const attestations = [ssz.phase0.Attestation.defaultValue()];
      const res = await client.submitPoolAttestations(attestations);

      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);

      const expectedErrorBody = {
        code: 400,
        message: "Some errors submitting attestations",
        failures: [{index: 0, message: "ATTESTATION_ERROR_NOT_EXACTLY_ONE_AGGREGATION_BIT_SET"}],
      };
      const expectedErrorMessage = `Bad Request: ${JSON.stringify(expectedErrorBody)}`;
      expect(res.error?.message).toEqual(expectedErrorMessage);
    });
  });

  describe("submitPoolBlsToExecutionChange", () => {
    it("should return correctly formatted errors responses", async () => {
      const blsToExecutionChanges = [ssz.capella.SignedBLSToExecutionChange.defaultValue()];
      const res = await client.submitPoolBlsToExecutionChange(blsToExecutionChanges);

      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);

      const expectedErrorBody = {
        code: 400,
        message: "Some errors submitting BLS to execution change",
        failures: [{index: 0, message: "BLS_TO_EXECUTION_CHANGE_ERROR_INVALID"}],
      };
      const expectedErrorMessage = `Bad Request: ${JSON.stringify(expectedErrorBody)}`;
      expect(res.error?.message).toEqual(expectedErrorMessage);
    });
  });

  describe("submitPoolSyncCommitteeSignatures", () => {
    it("should return correctly formatted errors responses", async () => {
      const signatures = [ssz.altair.SyncCommitteeMessage.defaultValue()];
      const res = await client.submitPoolSyncCommitteeSignatures(signatures);

      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);

      const expectedErrorBody = {
        code: 400,
        message: "Some errors submitting sync committee signatures",
        failures: [{index: 0, message: "Empty SyncCommitteeCache"}],
      };
      const expectedErrorMessage = `Bad Request: ${JSON.stringify(expectedErrorBody)}`;
      expect(res.error?.message).toEqual(expectedErrorMessage);
    });
  });
});
