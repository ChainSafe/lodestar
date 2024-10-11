/* eslint-disable no-console */
import {writeFile, mkdir} from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import axios from "axios";
const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

type JSONRequest = {method: string; params: unknown[]};
type JSONBatchRequest = JSONRequest[];
type JSONPayload = JSONRequest & {id: number; jsonrpc: string};
type JSONBatchPayload = JSONPayload[];

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

const requestToPayload = ({method, params}: JSONRequest): JSONPayload => ({
  id: idIndex++,
  jsonrpc: "2.0",
  method,
  params,
});

async function rawEth(
  network: NETWORK,
  request: JSONRequest | JSONBatchRequest
): Promise<{payload: JSONPayload | JSONBatchPayload; response: Record<string, unknown>}> {
  const payload = Array.isArray(request) ? request.map(requestToPayload) : requestToPayload(request);

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
  request: JSONRequest;
  slot: number | string;
  dependentRequests?: (JSONRequest | JSONBatchRequest)[];
};

type Block = {hash: string; number: string};

const getBlockByNumber = async (network: NETWORK, number: string | number, dehydrate = false): Promise<Block> => {
  const {response} = await rawEth(network, {method: "eth_getBlockByNumber", params: [number, dehydrate]});

  if (response.error || !response.result) {
    throw new Error("Invalid response" + JSON.stringify(response));
  }

  return response.result as Block;
};

const getBlockByHash = async (network: NETWORK, hash: string | number, dehydrate = false): Promise<Block> => {
  const {response} = await rawEth(network, {method: "eth_getBlockByHash", params: [hash, dehydrate]});

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
  const {payload: request, response} = await rawEth(network, opts.request);
  if (response.error || !response.result) {
    throw new Error("Invalid response" + JSON.stringify(response));
  }

  const beacon = {
        executionPayload: ((await rawBeacon(network, `eth/v2/beacon/blocks/${slot}`)) as any).data.message.body
      .execution_payload,
        headers: ((await rawBeacon(network, `eth/v1/beacon/headers/${slot}`)) as any).data,
  };

  const payloadBlock = await getBlockByHash(
    network,
        (beacon.executionPayload as {block_hash: string}).block_hash,
    true
  );

  const execution = {
    block: payloadBlock,
  };

  const dependentRequests = [];
  for (const req of opts.dependentRequests ?? []) {
    const {payload, response} = await rawEth(network, req);
    if (!Array.isArray(payload) && (response.error || !response.result)) {
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
      [
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
    ],
  }),
  "mainnet"
);

await generateFixture(
  "eth_estimateGas_simple_transfer",
  ({latest}) => ({
    request: {
      method: "eth_estimateGas",
      params: [
        {
          from: "0x690B9A9E9aa1C9dB991C7721a92d351Db4FaC990",
          to: "0x388c818ca8b9251b393131c08a736a67ccb19297",
          value: "0xFF00900",
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
            to: "0x388c818ca8b9251b393131c08a736a67ccb19297",
            from: "0x690b9a9e9aa1c9db991c7721a92d351db4fac990",
            value: "0xff00900",
            gas: "0x1c9c380",
            gasPrice: "0x0",
          },
          latest,
        ],
      },
      [
        {
          method: "eth_getProof",
          params: ["0x690b9a9e9aa1c9db991c7721a92d351db4fac990", [], latest],
        },
        {
          method: "eth_getCode",
          params: ["0x690b9a9e9aa1c9db991c7721a92d351db4fac990", latest],
        },
        {
          method: "eth_getProof",
          params: ["0x388c818ca8b9251b393131c08a736a67ccb19297", [], latest],
        },
        {
          method: "eth_getCode",
          params: ["0x388c818ca8b9251b393131c08a736a67ccb19297", latest],
        },
      ],
    ],
  }),
  "mainnet"
);

await generateFixture(
  "eth_estimateGas_contract_call",
  ({latest}) => ({
    request: {
      method: "eth_estimateGas",
      params: [
        {
          data: "0xd05c78da000000000000000000000000000000000000000000000000000000025408a08b000000000000000000000000000000000000000000000000000000cef5d5bf7f",
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
            data: "0xd05c78da000000000000000000000000000000000000000000000000000000025408a08b000000000000000000000000000000000000000000000000000000cef5d5bf7f",
            gas: "0x1c9c380",
            gasPrice: "0x0",
          },
          latest,
        ],
      },
      [
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
    ],
  }),
  "mainnet"
);
