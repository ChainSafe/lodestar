/* eslint-disable no-console */
import {writeFile, mkdir} from "node:fs/promises";
import path from "node:path";
import url from "node:url";
// eslint-disable-next-line import/no-extraneous-dependencies
import axios from "axios";
// eslint-disable-next-line @typescript-eslint/naming-convention
const __filename = url.fileURLToPath(import.meta.url);
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

type NETWORK = "sepolia" | "mainnet";
const networkURLs: Record<NETWORK, {beacon: string; rpc: string}> = {
  sepolia: {
    beacon: "https://lodestar-sepolia.chainsafe.io",
    rpc: "https://lodestar-sepoliarpc.chainsafe.io",
  },
  mainnet: {
    beacon: "https://lodestar-mainnet.chainsafe.io",
    rpc: "https://lodestar-mainnetrpc.chainsafe.io",
  },
};

let idIndex = Math.floor(Math.random() * 1000000);

async function rawEth(network: NETWORK, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (await axios({url: networkURLs[network].rpc, method: "post", data: payload, responseType: "json"}))
    .data as Record<string, unknown>;
}

async function rawBeacon(network: NETWORK, path: string): Promise<Record<string, unknown>> {
  return (await axios.get(`${networkURLs[network].beacon}/${path}`)).data as Record<string, unknown>;
}

async function generateFixture(
  label: string,
  {method, params}: {method: string; params: unknown[]},
  {slot}: {slot: number | string},
  network: NETWORK = "sepolia"
): Promise<void> {
  const request = {id: idIndex++, jsonrpc: "2.0", method, params};
  const response = await rawEth(network, request);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  const executionPayload: unknown = ((await rawBeacon(network, `eth/v2/beacon/blocks/${slot}`)) as any).data.message
    .body.execution_payload;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  const headers: unknown = ((await rawBeacon(network, `eth/v1/beacon/headers/${slot}`)) as any).data;

  if (response.error || !response.result) {
    throw new Error("Invalid response" + JSON.stringify(response));
  }

  const fixture = {
    label,
    network,
    request,
    response,
    executionPayload,
    headers,
  };

  const dir = path.join(__dirname, "..", "test/fixtures", network);
  await mkdir(dir, {recursive: true});
  await writeFile(path.join(dir, `${label}.json`), JSON.stringify(fixture, null, 2));

  console.info("Generated fixture:", label);
}

await generateFixture(
  "eth_getBlock_with_no_accessList",
  {
    method: "eth_getBlockByHash",
    params: ["0x75b10426177f0f4bd8683999e2c7c597007c6e7c4551d6336c0f880b12c6f3bf", true],
  },
  {slot: 2144468}
);

await generateFixture(
  "eth_getBlock_with_contractCreation",
  {
    method: "eth_getBlockByHash",
    params: ["0x3a0225b38d5927a37cc95fd48254e83c4e9b70115918a103d9fd7e36464030d4", true],
  },
  {slot: 625024}
);

await generateFixture(
  "eth_getBalance_eoa",
  {method: "eth_getBalance", params: ["0xC4bFccB1668d6E464F33a76baDD8C8D7D341e04A", "latest"]},
  {slot: "head"}
);

await generateFixture(
  "eth_getBalance_eoa",
  {method: "eth_getBalance", params: ["0xC4bFccB1668d6E464F33a76baDD8C8D7D341e04A", "latest"]},
  {slot: "head"}
);

await generateFixture(
  "eth_getBalance_eoa_proof",
  {method: "eth_getProof", params: ["0xC4bFccB1668d6E464F33a76baDD8C8D7D341e04A", [], "latest"]},
  {slot: "head"}
);

await generateFixture(
  "eth_getBalance_contract",
  {method: "eth_getBalance", params: ["0xa54aeF0dAB669e8e1A164BCcB323549a818a0497", "latest"]},
  {slot: "head"}
);

await generateFixture(
  "eth_getBalance_contract_proof",
  {method: "eth_getProof", params: ["0xa54aeF0dAB669e8e1A164BCcB323549a818a0497", [], "latest"]},
  {slot: "head"}
);

await generateFixture(
  "eth_getCode",
  {method: "eth_getCode", params: ["0xa54aeF0dAB669e8e1A164BCcB323549a818a0497", "latest"]},
  {slot: "head"}
);
