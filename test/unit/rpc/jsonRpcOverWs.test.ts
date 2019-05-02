import { assert } from "chai";
import * as jsonRpc from "noice-json-rpc";
import Websocket from "ws";
import {MockAPI, JSONRPC, BeaconApi, WSServer} from "../../../src/rpc";
import { generateEmptyBlock } from "../../utils/block";
import { generateEmptyAttestation } from "../../utils/attestation";

describe("Json RPC over WS", () => {
  const rpc = new JSONRPC({}, {transport: new WSServer({port: 32420}), api: new MockAPI()});
  let client;
  let ws;
  let clientApi: {BeaconChain: BeaconApi};
  before(async () => {
    await rpc.start();
    ws = new Websocket("ws://localhost:32420");
    client = new jsonRpc.Client(ws);
    clientApi = client.api();
  })
  after(async () => {
    await rpc.stop();
  })
  it("should get the chain head", async () => {
    const head = await clientApi.BeaconChain.getChainHead();
    assert.ok(head);
  })
  it("should get pending attestations", async () => {
    const attestations = await clientApi.BeaconChain.getPendingAttestations();
    assert.ok(attestations);
  })
  it("should get pending deposits", async () => {
    const deposits = await clientApi.BeaconChain.getPendingDeposits();
    assert.ok(deposits);
  })
  it("should get eth1 data", async () => {
    const eth1Data = await clientApi.BeaconChain.getEth1Data();
    assert.ok(eth1Data);
  })
  it("should compute the state root", async () => {
    const root = await clientApi.BeaconChain.computeStateRoot(generateEmptyBlock());
    assert.ok(root);
  })
  it("should get attestation data", async () => {
    const data = await clientApi.BeaconChain.getAttestationData(0, 0);
    assert.ok(data);
  })
  it("should accept an attestation submission", async () => {
    await clientApi.BeaconChain.putAttestation(generateEmptyAttestation());
    assert.ok(true);
  })
  it("should accept a block submission", async () => {
    await clientApi.BeaconChain.putBlock(generateEmptyBlock());
    assert.ok(true);
  })
  it("should fail for unknown methods", async () => {
    try {
      await (clientApi.BeaconChain as any).foo();
      assert.fail('Unknown/undefined method should fail');
    } catch (e) {}
  })

});
