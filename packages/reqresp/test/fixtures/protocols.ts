import {ContainerType, UintNumberType, ListBasicType, ValueOf} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {ContextBytesType, DialOnlyProtocol, Encoding, ProtocolHandler, Protocol} from "../../src/types.js";
import {getEmptyHandler} from "./messages.js";
import {beaconConfig} from "./messages.js";

const NumToStrReq = new ContainerType(
  {
    value: new UintNumberType(4),
  },
  {typeName: "NumberToStringReq", jsonCase: "eth2"}
);

export type NumToStrReqType = ValueOf<typeof NumToStrReq>;

const NumToStrResp = new ContainerType(
  {
    value: new ListBasicType(new UintNumberType(1), 4),
  },
  {typeName: "NumberToStringResp", jsonCase: "eth2"}
);
export type NumToStrRespType = ValueOf<typeof NumToStrResp>;

export const numberToStringProtocolDialOnly: DialOnlyProtocol = {
  method: "number_to_string",
  version: 1,
  encoding: Encoding.SSZ_SNAPPY,
  contextBytes: {type: ContextBytesType.Empty},
  requestSizes: {minSize: 0, maxSize: Infinity},
  responseSizes: () => ({minSize: 0, maxSize: Infinity}),
};

export const numberToStringProtocol: Protocol = {
  ...numberToStringProtocolDialOnly,
  inboundRateLimits: {
    // Rationale: https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
    byPeer: {quota: 5, quotaTimeMs: 15_000},
  },
  handler: async function* handler(req) {
    yield {
      data: Buffer.from(req.data.toString(), "utf8"),
      fork: ForkName.phase0,
    };
  },
};

export function pingProtocol(handler: ProtocolHandler): Protocol {
  return {
    handler,
    requestSizes: ssz.phase0.Ping,
    responseSizes: () => ssz.phase0.Ping,
    contextBytes: {type: ContextBytesType.Empty},
    method: "ping",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
  };
}

type ProtocolOptions = {
  requestMinSize?: number;
  contextBytesType?: ContextBytesType;
  noRequest?: boolean;
  version?: number;
};

export function customProtocol(opts: ProtocolOptions): Protocol {
  return {
    handler: getEmptyHandler(),
    requestSizes: opts.noRequest ? null : {minSize: opts.requestMinSize ?? 0, maxSize: Infinity},
    responseSizes: () => ({minSize: 0, maxSize: Infinity}),
    contextBytes:
      opts.contextBytesType === ContextBytesType.ForkDigest
        ? {type: ContextBytesType.ForkDigest, forkDigestContext: beaconConfig}
        : {type: ContextBytesType.Empty},
    method: "req/test",
    version: opts.version ?? 1,
    encoding: Encoding.SSZ_SNAPPY,
  };
}
