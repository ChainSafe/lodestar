import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ResponseBody} from "@chainsafe/lodestar-types";
import {Method, Methods, ReqRespEncoding, RpcResponseStatus} from "../../../../../src/constants";
import {createRpcProtocol, parseProtocolId} from "../../../../../src/network/util";

interface INetworkResponseTestDataMeta {
  protocol: string; // '/eth2/beacon_chain/req/status/1/'
  result: RpcResponseStatus;
  chunks: string[]; // Array of hex (0x prefixed) chunks
}

export function writeNetworkResponseTestData(
  testDir: string,
  data: {
    result: RpcResponseStatus;
    method: Method;
    encoding: ReqRespEncoding;
    chunks: Uint8Array[];
    responseBody: ResponseBody[];
  }
): void {
  const metaYamlData: INetworkResponseTestDataMeta = {
    protocol: createRpcProtocol(data.method, ReqRespEncoding.SSZ_SNAPPY),
    result: data.result,
    chunks: data.chunks.map(toHexString),
  };

  let metaYamlString: string;
  try {
    metaYamlString = yaml.safeDump(metaYamlData, {
      noArrayIndent: true,
      condenseFlow: true,
      lineWidth: Infinity,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(metaYamlData);
    throw e;
  }

  fs.mkdirSync(testDir, {recursive: true});

  fs.writeFileSync(path.join(testDir, "meta.yaml"), metaYamlString);

  serializeBody(data.method, data.responseBody).forEach((bodyChunk, i) => {
    fs.writeFileSync(path.join(testDir, `chunk_${i}.szz`), bodyChunk);
  });
}

export function parseNetworkResponseTestData(
  testDir: string
): {
  result: RpcResponseStatus;
  method: Method;
  encoding: ReqRespEncoding;
  chunks: Uint8Array[];
  responseBody: ResponseBody[];
} {
  const metaFilepath = path.join(testDir, "meta.yaml");

  const testData = yaml.load(fs.readFileSync(metaFilepath, "utf8")) as INetworkResponseTestDataMeta;

  const result = testData.result;
  const chunks = testData.chunks.map(fromHexString);
  const {method, encoding} = parseProtocolId(testData.protocol);

  const chunksSerialized = fs
    .readdirSync(testDir)
    .filter((file) => /chunk_\d*.szz/.test(file))
    .map((file) => fs.readFileSync(path.join(testDir, file)));

  const responseBody = deserializeBody(method, chunksSerialized);

  return {
    result,
    method,
    encoding,
    chunks,
    responseBody,
  };
}

function serializeBody(method: Method, requestBody: ResponseBody | ResponseBody[]): Uint8Array[] {
  const type = Methods[method].responseSSZType(config);

  if (!Array.isArray(requestBody)) requestBody = [requestBody];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return requestBody.map((chunk) => type.serialize(chunk as any));
}

function deserializeBody(method: Method, chunksSerialized: Uint8Array[]): ResponseBody[] {
  const type = Methods[method].responseSSZType(config);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return chunksSerialized.map((chunk) => type.deserialize(chunk as any));
}
