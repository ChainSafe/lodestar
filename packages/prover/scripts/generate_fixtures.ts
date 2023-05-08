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

async function rawEth(
  network: NETWORK,
  method: string,
  params: unknown[]
): Promise<{payload: Record<string, unknown>; response: Record<string, unknown>}> {
  const payload = {id: idIndex++, jsonrpc: "2.0", method, params};

  const response = (
    await axios({
      url: networkURLs[network].rpc,
      method: "post",
      data: payload,
      responseType: "json",
    })
  ).data as Record<string, unknown>;

  return {payload, response};
}

async function rawBeacon(network: NETWORK, path: string): Promise<Record<string, unknown>> {
  return (await axios.get(`${networkURLs[network].beacon}/${path}`)).data as Record<string, unknown>;
}

type Generator = (opts: {latest: string; finalized: string}) => {
  request: {method: string; params: unknown[]};
  slot: number | string;
  dependentRequests?: {method: string; params: unknown[]}[];
};

type Block = {hash: string; number: string};

const getBlockByNumber = async (network: NETWORK, number: string | number, dehydrate = false): Promise<Block> => {
  const {response} = await rawEth(network, "eth_getBlockByNumber", [number, dehydrate]);

  if (response.error || !response.result) {
    throw new Error("Invalid response" + JSON.stringify(response));
  }

  return response.result as Block;
};

const getBlockByHash = async (network: NETWORK, hash: string | number, dehydrate = false): Promise<Block> => {
  const {response} = await rawEth(network, "eth_getBlockByHash", [hash, dehydrate]);

  if (response.error || !response.result) {
    throw new Error("Invalid response" + JSON.stringify(response));
  }

  return response.result as Block;
};

async function generateFixture(label: string, generator: Generator, network: NETWORK = "sepolia"): Promise<void> {
  const latest = await getBlockByNumber(network, "latest");
  const finalized = await getBlockByNumber(network, "finalized");

  const opts = generator({latest: latest.hash, finalized: finalized.hash});
  const slot = opts.slot;
  const {payload: request, response} = await rawEth(network, opts.request.method, opts.request.params);
  if (response.error || !response.result) {
    throw new Error("Invalid response" + JSON.stringify(response));
  }

  const beacon = {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    executionPayload: ((await rawBeacon(network, `eth/v2/beacon/blocks/${slot}`)) as any).data.message.body
      .execution_payload,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    headers: ((await rawBeacon(network, `eth/v1/beacon/headers/${slot}`)) as any).data,
  };

  const payloadBlock = await getBlockByHash(
    network,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    (beacon.executionPayload as {block_hash: string}).block_hash,
    true
  );

  const execution = {
    block: payloadBlock,
  };

  const dependentRequests = [];
  for (const {method, params} of opts.dependentRequests ?? []) {
    const {payload, response} = await rawEth(network, method, params);
    if (response.error || !response.result) {
      throw new Error("Invalid response" + JSON.stringify(response));
    }
    dependentRequests.push({payload, response});
  }

  const fixture = {
    label,
    network,
    request,
    response,
    beacon,
    execution,
    dependentRequests,
  };

  const dir = path.join(__dirname, "..", "test/fixtures", network);
  await mkdir(dir, {recursive: true});
  await writeFile(path.join(dir, `${label}.json`), JSON.stringify(fixture, null, 2));

  console.info("Generated fixture:", label);
}

await generateFixture("eth_getBlock_with_no_accessList", () => ({
  request: {
    method: "eth_getBlockByHash",
    params: ["0x75b10426177f0f4bd8683999e2c7c597007c6e7c4551d6336c0f880b12c6f3bf", true],
  },
  slot: 2144468,
}));

await generateFixture("eth_getBlock_with_contractCreation", () => ({
  request: {
    method: "eth_getBlockByHash",
    params: ["0x3a0225b38d5927a37cc95fd48254e83c4e9b70115918a103d9fd7e36464030d4", true],
  },
  slot: 625024,
}));

await generateFixture("eth_getBalance_eoa", ({latest}) => ({
  request: {method: "eth_getBalance", params: ["0xC4bFccB1668d6E464F33a76baDD8C8D7D341e04A", latest]},
  slot: "head",
  dependentRequests: [{method: "eth_getProof", params: ["0xC4bFccB1668d6E464F33a76baDD8C8D7D341e04A", [], latest]}],
}));

await generateFixture("eth_getBalance_contract", ({latest}) => ({
  request: {method: "eth_getBalance", params: ["0xa54aeF0dAB669e8e1A164BCcB323549a818a0497", latest]},
  slot: "head",
  dependentRequests: [{method: "eth_getProof", params: ["0xa54aeF0dAB669e8e1A164BCcB323549a818a0497", [], latest]}],
}));

await generateFixture("eth_getCode", ({latest}) => ({
  request: {method: "eth_getCode", params: ["0xa54aeF0dAB669e8e1A164BCcB323549a818a0497", latest]},
  slot: "head",
  dependentRequests: [{method: "eth_getProof", params: ["0xa54aeF0dAB669e8e1A164BCcB323549a818a0497", [], latest]}],
}));

await generateFixture("eth_getTransactionCount", ({latest}) => ({
  request: {method: "eth_getTransactionCount", params: ["0xC4bFccB1668d6E464F33a76baDD8C8D7D341e04A", latest]},
  slot: "head",
  dependentRequests: [{method: "eth_getProof", params: ["0xC4bFccB1668d6E464F33a76baDD8C8D7D341e04A", [], latest]}],
}));

await generateFixture(
  "eth_call",
  ({latest}) => ({
    request: {
      method: "eth_call",
      params: [
        {
          data: "0xe6cb901300000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000005",
          to: "0xade2a9c8b033d60ffcdb8cfc974dd87b2a9c1f27",
        },
        latest,
      ],
    },
    slot: "head",
    dependentRequests: [
      {
        method: "eth_createAccessList",
        params: [
          {
            to: "0xade2a9c8b033d60ffcdb8cfc974dd87b2a9c1f27",
            from: "0x0000000000000000000000000000000000000000",
            data: "0xe6cb901300000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000005",
            value: undefined,
            gas: "0x1c9c380",
            gasPrice: "0x0",
          },
          latest,
        ],
      },
      {
        method: "eth_getProof",
        params: ["0x0000000000000000000000000000000000000000", [], latest],
      },
      {
        method: "eth_getCode",
        params: ["0x0000000000000000000000000000000000000000", latest],
      },
      {
        method: "eth_getProof",
        params: ["0xade2a9c8b033d60ffcdb8cfc974dd87b2a9c1f27", [], latest],
      },
      {
        method: "eth_getCode",
        params: ["0xade2a9c8b033d60ffcdb8cfc974dd87b2a9c1f27", latest],
      },
    ],
  }),
  "mainnet"
);
