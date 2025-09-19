import {CONSOLIDATION_REQUEST_TYPE, DEPOSIT_REQUEST_TYPE, WITHDRAWAL_REQUEST_TYPE} from "@lodestar/params";
import {ExecutionRequests, ssz} from "@lodestar/types";
import {fromHex, strip0xPrefix} from "@lodestar/utils";
import {describe, expect, it} from "vitest";
import {deserializeExecutionRequests, serializeExecutionRequests} from "../../../../src/execution/engine/types.js";

describe("execution / engine / types", () => {
  describe("serializeExecutionRequests", () => {
    it("should serialize execution requests according to EIP-7685", () => {
      const executionRequests: ExecutionRequests = {
        deposits: [ssz.electra.DepositRequest.defaultValue()],
        withdrawals: [ssz.electra.WithdrawalRequest.defaultValue()],
        consolidations: [ssz.electra.ConsolidationRequest.defaultValue()],
      };

      const serialized = serializeExecutionRequests(executionRequests).map(strip0xPrefix);

      // Assert 1-byte request_type prefix is set correctly
      expect(serialized.length).toBe(3);
      expect(Number(serialized[0].substring(0, 2))).toBe(DEPOSIT_REQUEST_TYPE);
      expect(Number(serialized[1].substring(0, 2))).toBe(WITHDRAWAL_REQUEST_TYPE);
      expect(Number(serialized[2].substring(0, 2))).toBe(CONSOLIDATION_REQUEST_TYPE);

      // Assert execution requests can be deserialized
      expect(ssz.electra.DepositRequests.deserialize(fromHex(serialized[0].slice(2)))).toEqual(
        executionRequests.deposits
      );
      expect(ssz.electra.WithdrawalRequests.deserialize(fromHex(serialized[1].slice(2)))).toEqual(
        executionRequests.withdrawals
      );
      expect(ssz.electra.ConsolidationRequests.deserialize(fromHex(serialized[2].slice(2)))).toEqual(
        executionRequests.consolidations
      );
    });

    it("should omit empty requests when serializing data", () => {
      const executionRequests: ExecutionRequests = {
        deposits: [ssz.electra.DepositRequest.defaultValue()],
        withdrawals: [],
        consolidations: [ssz.electra.ConsolidationRequest.defaultValue()],
      };

      const serialized = serializeExecutionRequests(executionRequests).map(strip0xPrefix);

      // Assert withdrawals are omitted
      expect(serialized.length).toBe(2);
      expect(Number(serialized[0].substring(0, 2))).toBe(DEPOSIT_REQUEST_TYPE);
      expect(Number(serialized[1].substring(0, 2))).toBe(CONSOLIDATION_REQUEST_TYPE);

      // Assert execution requests can be deserialized
      expect(ssz.electra.DepositRequests.deserialize(fromHex(serialized[0].slice(2)))).toEqual(
        executionRequests.deposits
      );
      expect(ssz.electra.ConsolidationRequests.deserialize(fromHex(serialized[1].slice(2)))).toEqual(
        executionRequests.consolidations
      );
    });

    it("should return an empty array if all requests are empty", () => {
      const executionRequests: ExecutionRequests = {
        deposits: [],
        withdrawals: [],
        consolidations: [],
      };

      const serialized = serializeExecutionRequests(executionRequests);

      expect(serialized.length).toBe(0);
    });
  });

  describe("deserializeExecutionRequests", () => {
    // From https://github.com/ethereum/execution-apis/blob/f6a6f52bccdb05f8b2f894a56fe1232432069d65/src/engine/openrpc/methods/payload.yaml#L553-L556
    const serializedRequests: string[] = [
      "0x0096a96086cff07df17668f35f7418ef8798079167e3f4f9b72ecde17b28226137cf454ab1dd20ef5d924786ab3483c2f9003f" +
        "5102dabe0a27b1746098d1dc17a5d3fbd478759fea9287e4e419b3c3cef20100000000000000b1acdb2c4d3df3f1b8d3bfd334" +
        "21660df358d84d78d16c4603551935f4b67643373e7eb63dcb16ec359be0ec41fee33b03a16e80745f2374ff1d3c352508ac5d" +
        "857c6476d3c3bcf7e6ca37427c9209f17be3af5264c0e2132b3dd1156c28b4e9f000000000000000a5c85a60ba2905c215f6a1" +
        "2872e62b1ee037051364244043a5f639aa81b04a204c55e7cc851f29c7c183be253ea1510b001db70c485b6264692f26b8aeaa" +
        "b5b0c384180df8e2184a21a808a3ec8e86ca01000000000000009561731785b48cf1886412234531e4940064584463e96ac63a" +
        "1a154320227e333fb51addc4a89b7e0d3f862d7c1fd4ea03bd8eb3d8806f1e7daf591cbbbb92b0beb74d13c01617f22c5026b4" +
        "f9f9f294a8a7c32db895de3b01bee0132c9209e1f100000000000000",
      "0x01a94f5374fce5edbc8e2a8697c15331677e6ebf0b85103a5617937691dfeeb89b86a80d5dc9e3c9d3a1a0e7ce311e26e0bb73" +
        "2eabaa47ffa288f0d54de28209a62a7d29d0000000000000000000000000000000000000000000000000000010f698daeed734" +
        "da114470da559bd4b4c7259e1f7952555241dcbc90cf194a2ef676fc6005f3672fada2a3645edb297a75530100000000000000",
      "0x02a94f5374fce5edbc8e2a8697c15331677e6ebf0b85103a5617937691dfeeb89b86a80d5dc9e3c9d3a1a0e7ce311e26e0bb73" +
        "2eabaa47ffa288f0d54de28209a62a7d29d098daeed734da114470da559bd4b4c7259e1f7952555241dcbc90cf194a2ef676fc" +
        "6005f3672fada2a3645edb297a7553",
    ];

    it("should deserialize execution requests according to EIP-7685", () => {
      const executionRequests = deserializeExecutionRequests(serializedRequests);

      expect(executionRequests.deposits.length).toBe(2);
      expect(executionRequests.withdrawals.length).toBe(2);
      expect(executionRequests.consolidations.length).toBe(1);

      expect(serializeExecutionRequests(executionRequests)).toEqual(serializedRequests);
    });

    it("should correctly deserialize if execution request is omitted", () => {
      const serializedOmitted = [serializedRequests[0], serializedRequests[2]];

      const executionRequests = deserializeExecutionRequests(serializedOmitted);

      expect(executionRequests.deposits.length).toBe(2);
      expect(executionRequests.withdrawals.length).toBe(0);
      expect(executionRequests.consolidations.length).toBe(1);

      expect(serializeExecutionRequests(executionRequests)).toEqual(serializedOmitted);
    });

    it("should throw an error if execution requests order is incorrect", () => {
      const serializedUnordered = [serializedRequests[0], serializedRequests[2], serializedRequests[1]];

      expect(() => deserializeExecutionRequests(serializedUnordered)).toThrow();
    });

    it("should throw an error if execution request is missing type prefix", () => {
      const serializedNoPrefix = [serializedRequests[0], `0x${serializedRequests[1].slice(4)}`];

      expect(() => deserializeExecutionRequests(serializedNoPrefix)).toThrow();
    });

    it("should throw an error if execution request has incorrect prefix", () => {
      const serializedWrongPrefix = [serializedRequests[0], `0x05${serializedRequests[1].slice(4)}`];

      expect(() => deserializeExecutionRequests(serializedWrongPrefix)).toThrow();
    });

    it("should throw an error if execution request has no data", () => {
      const serializedNoData = [serializedRequests[0], "0x01", serializedRequests[2]];

      expect(() => deserializeExecutionRequests(serializedNoData)).toThrow();
    });
  });
});
