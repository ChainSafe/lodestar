import {describe, expect, it} from "vitest";
import {BitVectorType, ByteListType, ContainerType, ListCompositeType} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {
  BuiltPayloadBellatrix,
  BuiltPayloadCapella,
  BuiltPayloadDeneb,
  BuiltPayloadElectra,
  BuiltPayloadFulu,
  BuiltPayloadGloas,
  ExecutionPayloadEnvelopeBellatrix,
  ExecutionPayloadEnvelopeCapella,
  ExecutionPayloadEnvelopeDeneb,
  ExecutionPayloadEnvelopeElectra,
  ExecutionPayloadEnvelopeGloas,
  ForkchoiceUpdateGloas,
  ForkchoiceUpdateResponse,
  PayloadStatus,
} from "../../../../src/execution/engine/sszTypes.js";

// Independent wire fixtures from execution-apis at 5bcdc34a477b10af278c079525374e6a4046f291.
// Keep their field order independent of the engine types, which also reuse consensus types.
const requestsType = new ListCompositeType(new ByteListType(2 ** 30), 256);
const envelopeParis = new ContainerType({payload: ssz.bellatrix.ExecutionPayload});
const envelopeShanghai = new ContainerType({payload: ssz.capella.ExecutionPayload});
const envelopeCancun = new ContainerType({payload: ssz.deneb.ExecutionPayload, parentBeaconBlockRoot: ssz.Root});
const envelopePrague = new ContainerType({
  payload: ssz.deneb.ExecutionPayload,
  parentBeaconBlockRoot: ssz.Root,
  executionRequests: requestsType,
});
const envelopeAmsterdam = new ContainerType({
  payload: ssz.gloas.ExecutionPayload,
  parentBeaconBlockRoot: ssz.Root,
  executionRequests: requestsType,
});
const builtParis = new ContainerType({payload: ssz.bellatrix.ExecutionPayload, blockValue: ssz.UintBn256});
const builtShanghai = new ContainerType({payload: ssz.capella.ExecutionPayload, blockValue: ssz.UintBn256});
const builtCancun = new ContainerType({
  payload: ssz.deneb.ExecutionPayload,
  blockValue: ssz.UintBn256,
  blobsBundle: ssz.deneb.BlobsBundle,
  shouldOverrideBuilder: ssz.Boolean,
});
const builtPrague = new ContainerType({
  payload: ssz.deneb.ExecutionPayload,
  blockValue: ssz.UintBn256,
  blobsBundle: ssz.deneb.BlobsBundle,
  executionRequests: requestsType,
  shouldOverrideBuilder: ssz.Boolean,
});
const builtOsaka = new ContainerType({
  payload: ssz.deneb.ExecutionPayload,
  blockValue: ssz.UintBn256,
  blobsBundle: ssz.fulu.BlobsBundle,
  executionRequests: requestsType,
  shouldOverrideBuilder: ssz.Boolean,
});
const builtAmsterdam = new ContainerType({
  payload: ssz.gloas.ExecutionPayload,
  blockValue: ssz.UintBn256,
  blobsBundle: ssz.fulu.BlobsBundle,
  executionRequests: requestsType,
  shouldOverrideBuilder: ssz.Boolean,
});

describe("engine SSZ wire fixtures", () => {
  it("distinguishes absent and present but empty validation errors", () => {
    expect(PayloadStatus.deserialize(new Uint8Array([1, 9, 0, 0, 0, 9, 0, 0, 0])).validationError).toEqual([]);
    expect(PayloadStatus.deserialize(new Uint8Array([1, 9, 0, 0, 0, 9, 0, 0, 0, 4, 0, 0, 0])).validationError).toEqual([
      new Uint8Array(),
    ]);
  });

  it("decodes the nested optional payload id from literal bytes", () => {
    const bytes = new Uint8Array([8, 0, 0, 0, 17, 0, 0, 0, 0, 9, 0, 0, 0, 9, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(ForkchoiceUpdateResponse.deserialize(bytes)).toEqual({
      payloadStatus: {status: 0, latestValidHash: [], validationError: []},
      payloadId: [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])],
    });
  });

  it.each([
    {fork: "paris", actual: ExecutionPayloadEnvelopeBellatrix, oracle: envelopeParis},
    {fork: "shanghai", actual: ExecutionPayloadEnvelopeCapella, oracle: envelopeShanghai},
    {fork: "cancun", actual: ExecutionPayloadEnvelopeDeneb, oracle: envelopeCancun},
    {fork: "prague", actual: ExecutionPayloadEnvelopeElectra, oracle: envelopePrague},
    {fork: "amsterdam", actual: ExecutionPayloadEnvelopeGloas, oracle: envelopeAmsterdam},
  ])("matches the $fork envelope wire layout", ({actual, oracle}) => {
    const value = ExecutionPayloadEnvelopeGloas.defaultValue();
    value.payload.blockNumber = 7;
    value.payload.transactions = [new Uint8Array([2, 3])];
    value.parentBeaconBlockRoot.fill(0x11);
    value.executionRequests = [new Uint8Array([0, 1, 2]), new Uint8Array([3, 4, 5])];
    expect(actual.serialize(value)).toEqual(oracle.serialize(value));
  });

  it.each([
    {fork: "paris", actual: BuiltPayloadBellatrix, oracle: builtParis},
    {fork: "shanghai", actual: BuiltPayloadCapella, oracle: builtShanghai},
    {fork: "cancun", actual: BuiltPayloadDeneb, oracle: builtCancun},
    {fork: "prague", actual: BuiltPayloadElectra, oracle: builtPrague},
    {fork: "osaka", actual: BuiltPayloadFulu, oracle: builtOsaka},
    {fork: "amsterdam", actual: BuiltPayloadGloas, oracle: builtAmsterdam},
  ])("matches the $fork built payload wire layout", ({actual, oracle}) => {
    const value = BuiltPayloadGloas.defaultValue();
    value.payload.blockNumber = 7;
    value.blockValue = 42n;
    value.executionRequests = [new Uint8Array([0, 1, 2]), new Uint8Array([3, 4, 5])];
    value.shouldOverrideBuilder = true;
    expect(actual.serialize(value)).toEqual(oracle.serialize(value));
  });

  it("matches Amsterdam's attribute and custody column framing", () => {
    const attributes = new ContainerType({
      timestamp: ssz.UintNum64,
      prevRandao: ssz.Root,
      suggestedFeeRecipient: ssz.ExecutionAddress,
      withdrawals: ssz.capella.Withdrawals,
      parentBeaconBlockRoot: ssz.Root,
      slotNumber: ssz.UintNum64,
      targetGasLimit: ssz.UintBn64,
    });
    const oracle = new ContainerType({
      forkchoiceState: new ContainerType({
        headBlockHash: ssz.Root,
        safeBlockHash: ssz.Root,
        finalizedBlockHash: ssz.Root,
      }),
      payloadAttributes: new ListCompositeType(attributes, 1),
      custodyColumns: new ListCompositeType(new BitVectorType(128), 1),
    });
    const value = oracle.defaultValue();
    value.payloadAttributes = [{...attributes.defaultValue(), slotNumber: 9, targetGasLimit: 30_000_000n}];
    expect(ForkchoiceUpdateGloas.serialize(value)).toEqual(oracle.serialize(value));
  });

  it("pins the Amsterdam payload fields and plain container encoding", () => {
    expect(Object.keys(ssz.gloas.ExecutionPayload.fields)).toEqual([
      "parentHash",
      "feeRecipient",
      "stateRoot",
      "receiptsRoot",
      "logsBloom",
      "prevRandao",
      "blockNumber",
      "gasLimit",
      "gasUsed",
      "timestamp",
      "extraData",
      "baseFeePerGas",
      "blockHash",
      "transactions",
      "withdrawals",
      "blobGasUsed",
      "excessBlobGas",
      "blockAccessList",
      "slotNumber",
    ]);
    const plain = new ContainerType(ssz.gloas.ExecutionPayload.fields);
    const value = ssz.gloas.ExecutionPayload.defaultValue();
    value.blockNumber = 7;
    value.slotNumber = 11;
    value.blockAccessList = new Uint8Array([1, 2, 3]);
    value.transactions = [new Uint8Array([9, 9])];
    value.withdrawals = [ssz.capella.Withdrawal.defaultValue()];
    expect(ssz.gloas.ExecutionPayload.serialize(value)).toEqual(plain.serialize(value));
  });
});
