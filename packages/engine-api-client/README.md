# `@lodestar/engine-api-client`

[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![Eth Consensus Spec v1.1.10](https://img.shields.io/badge/ETH%20consensus--spec-1.1.10-blue)](https://github.com/ethereum/consensus-specs/releases/tag/v1.1.10)
![ES Version](https://img.shields.io/badge/ES-2020-yellow)
![Node Version](https://img.shields.io/badge/node-16.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

Lodestar client for [Engine JSON-RPC API](https://github.com/ethereum/execution-apis/tree/main/src/engine)

> **Note**
> No version of this package exist prior to version 1.2.1.

## Usage

```
yarn add @lodestar/engine-api-client
```

Provides method for interacting with the Engine API of the execution layer client as defined in [Engine JSON-RPC API](https://github.com/ethereum/execution-apis/tree/main/src/engine)

```ts
 const baseUrl = http://localhost:8551 // running execution layer client
 const controller = new AbortController()
 const jwtSecretHex = "" // "jwt secret shared with execution layer client"

 const executionEngine = new ExecutionEngineHttp(
   {
     urls: [baseUrl],
     retryAttempts: 1,
     retryDelay: 2000,
     queueMaxLength: 2,
     jwtSecretHex
   },
   {signal: controller.signal}
 );

 // Prepare a payload
 const payloadId = await executionEngine.notifyForkchoiceUpdate(
  genesisBlockHash,
  safeBlockHash,
  finalizedBlockHash,
  {
      timestamp: 1670578479,
      prevRandao: "0x58cab4a6ffcd733cacb4c9f13d71fe0ed53c7b75163c616f8fb86d7c7c2fcabf",
      suggestedFeeRecipient: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
  }
 );

 // Getting payload
 const payload = await executionEngine.getPayload(payloadId);

 // Execute payload
 const payloadResult = await executionEngine.notifyNewPayload(payload);

 // Update the fork choice
 await executionEngine.notifyForkchoiceUpdate(
     bytesToData(payload.blockHash),
     safeBlockHash,
     genesisBlockHash
 );
```

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
