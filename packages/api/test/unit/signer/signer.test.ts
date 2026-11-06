import {describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getClient} from "../../../src/signer/client.js";
import {Endpoints, SignableMessageType, getDefinitions} from "../../../src/signer/routes.js";
import {getRoutes} from "../../../src/signer/server/index.js";
import {runGenericServerTest} from "../../utils/genericServerTest.js";
import {signRequests, testData} from "./testData.js";

describe("signer", () => {
  runGenericServerTest<Endpoints>(
    config,
    (_config, httpClient) => getClient(httpClient),
    (_config, methods) => getRoutes(methods),
    testData
  );

  describe("sign request JSON round trip", () => {
    const {sign} = getDefinitions();

    it("covers every message type", () => {
      const types = new Set(Object.values(signRequests).map((request) => request.message.type));
      expect([...types].sort()).toEqual(Object.values(SignableMessageType).sort());
    });

    for (const [name, request] of Object.entries(signRequests)) {
      it(name, () => {
        const reqJson = sign.req.writeReqJson(request);
        // Simulate JSON serialization over the wire
        const parsed = sign.req.parseReqJson(JSON.parse(JSON.stringify(reqJson)));
        expect(parsed).toEqual(request);
      });
    }

    it("sends post-bellatrix blocks as block header", () => {
      const block = ssz.deneb.BeaconBlock.defaultValue();
      block.slot = 10;
      const reqJson = sign.req.writeReqJson({
        ...signRequests.ATTESTATION,
        message: {type: SignableMessageType.BLOCK_V2, version: ForkName.deneb, data: {block}},
      });
      const parsed = sign.req.parseReqJson(JSON.parse(JSON.stringify(reqJson)));
      expect(parsed.message).toEqual({
        type: SignableMessageType.BLOCK_V2,
        version: ForkName.deneb,
        data: {
          blockHeader: {
            slot: 10,
            proposerIndex: 0,
            parentRoot: block.parentRoot,
            stateRoot: block.stateRoot,
            bodyRoot: ssz.deneb.BeaconBlockBody.hashTreeRoot(block.body),
          },
        },
      });
    });

    it("sends blinded blocks as block header", () => {
      const block = ssz.deneb.BlindedBeaconBlock.defaultValue();
      const reqJson = sign.req.writeReqJson({
        ...signRequests.ATTESTATION,
        message: {type: SignableMessageType.BLOCK_V2, version: ForkName.deneb, data: {block}},
      });
      const parsed = sign.req.parseReqJson(JSON.parse(JSON.stringify(reqJson)));
      expect(parsed.message).toEqual({
        type: SignableMessageType.BLOCK_V2,
        version: ForkName.deneb,
        data: {
          blockHeader: {
            slot: 0,
            proposerIndex: 0,
            parentRoot: block.parentRoot,
            stateRoot: block.stateRoot,
            bodyRoot: ssz.deneb.BlindedBeaconBlockBody.hashTreeRoot(block.body),
          },
        },
      });
    });

    it("rejects unknown message types", () => {
      expect(() => sign.req.parseReqJson({params: {identifier: "0x00"}, body: {type: "UNKNOWN"}})).toThrow(
        "Unsupported signing request type UNKNOWN"
      );
    });

    it("rejects requests missing the message payload", () => {
      expect(() =>
        sign.req.parseReqJson({params: {identifier: "0x00"}, body: {type: SignableMessageType.ATTESTATION}})
      ).toThrow("Missing field attestation in signing request");
    });
  });
});
