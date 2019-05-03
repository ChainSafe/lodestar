import { assert } from "chai";
import * as jsonRpc from "noice-json-rpc";
import Websocket from "ws";
import {JSONRPC, IValidatorApi, WSServer} from "../../../src/rpc";
import { generateEmptyBlock } from "../../utils/block";
import {MockValidatorApi} from "../../utils/mocks/rpc/validator";
import { generateEmptyAttestation } from "../../utils/attestation";

describe("Json RPC over WS", () => {
  const rpc = new JSONRPC({}, {transport: new WSServer({port: 32420}), api: new MockValidatorApi()});
  let client;
  let ws;
  let clientApi: {BeaconChain: IValidatorApi};
  before(async () => {
    await rpc.start();
    ws = new Websocket("ws://localhost:32420");
    client = new jsonRpc.Client(ws);
    clientApi = client.api();
  });
  after(async () => {
    await rpc.stop();
  });
  it("should get the chain version", async () => {
    const head = await clientApi.BeaconChain.getClientVersion();
    assert.ok(head);
  });
  it("should get the fork version", async () => {
    const attestations = await clientApi.BeaconChain.getFork();
    assert.ok(attestations);
  });
  it("should get the genesis time", async () => {
    const deposits = await clientApi.BeaconChain.getGenesisTime();
    assert.ok(deposits);
  });
  it("should get the sync status", async () => {
    const eth1Data = await clientApi.BeaconChain.getSyncingStatus();
    assert.ok(eth1Data);
  });
  it("should get validator duties", async () => {
    const root = await clientApi.BeaconChain.getDuties(Buffer.alloc(48));
    assert.ok(root);
  });
  it("should produce a block for the validator", async () => {
    const data = await clientApi.BeaconChain.produceBlock(0, Buffer.alloc(0));
    assert.ok(data);
  });
  it("should produce an attestation", async () => {
    await clientApi.BeaconChain.produceAttestation(0,1);
    assert.ok(true);
  });
  it("should accept an attestation submission", async () => {
    await clientApi.BeaconChain.publishAttestation(generateEmptyAttestation());
    assert.ok(true);
  });
  it("should accept a block submission", async () => {
    await clientApi.BeaconChain.publishBlock(generateEmptyBlock());
    assert.ok(true);
  });
  it("should fail for unknown methods", async () => {
    try {
      await (clientApi.BeaconChain as any).foo();
      assert.fail('Unknown/undefined method should fail');
    } catch (e) {}
  })
});
