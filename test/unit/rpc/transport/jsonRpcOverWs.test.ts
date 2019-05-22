import { assert } from "chai";
import * as jsonRpc from "noice-json-rpc";
import Websocket from "ws";
import {JSONRPC, IValidatorApi, WSServer, IBeaconApi} from "../../../../src/rpc";
import { generateEmptyBlock } from "../../../utils/block";
import {MockValidatorApi} from "../../../utils/mocks/rpc/validator";
import { generateEmptyAttestation } from "../../../utils/attestation";
import {MockBeaconApi} from "../../../utils/mocks/rpc/beacon";

describe("Json RPC over WS", () => {
  const rpc = new JSONRPC(
    {},
    {
      transports: [new WSServer({port: 32420})],
      apis: [
        new MockBeaconApi(),
        new MockValidatorApi()
      ]
    });
  let client;
  let ws;
  let clientApi: {validator: IValidatorApi, beacon: IBeaconApi};
  before(async () => {
    await rpc.start();
    ws = new Websocket("ws://localhost:32420");
    client = new jsonRpc.Client(ws);
    clientApi = client.api();
  });
  after(async () => {
    await rpc.stop();
  });
  it("should get the client version", async () => {
    const version = await clientApi.beacon.getClientVersion();
    assert.ok(version);
  });
  it("should get the fork version", async () => {
    const fork = await clientApi.beacon.getFork();
    assert.ok(fork);
  });
  it("should get the genesis time", async () => {
    const time = await clientApi.beacon.getGenesisTime();
    assert.ok(time);
  });
  it("should get the sync status", async () => {
    const status = await clientApi.beacon.getSyncingStatus();
    assert.ok(status);
  });
  it("should get validator duties", async () => {
    const duties = await clientApi.validator.getDuties(1);
    assert.ok(duties);
  });
  it("should produce a block for the validator", async () => {
    const block = await clientApi.validator.produceBlock(0, Buffer.alloc(0));
    assert.ok(block);
  });
  it("should produce an attestation", async () => {
    await clientApi.validator.produceAttestation(0,1);
    assert.ok(true);
  });
  it("should accept an attestation submission", async () => {
    await clientApi.validator.publishAttestation(generateEmptyAttestation());
    assert.ok(true);
  });
  it("should accept a block submission", async () => {
    await clientApi.validator.publishBlock(generateEmptyBlock());
    assert.ok(true);
  });
  it("should fail for unknown methods", async () => {
    try {
      await (clientApi.validator as any).foo();
      assert.fail('Unknown/undefined method should fail');
    } catch (e) {}
  })
});
