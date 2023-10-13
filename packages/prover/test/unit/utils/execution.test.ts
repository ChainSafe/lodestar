import {describe, it, expect} from "vitest";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import deepmerge from "deepmerge";
import {getEnvLogger} from "@lodestar/logger/env";
import {ELProof, ELStorageProof} from "../../../src/types.js";
import {isValidAccount, isValidStorageKeys} from "../../../src/utils/validation.js";
import {invalidStorageProof, validStorageProof} from "../../fixtures/index.js";
import eoaProof from "../../fixtures/sepolia/eth_getBalance_eoa.json" assert {type: "json"};
import {hexToBuffer} from "../../../src/utils/conversion.js";

const address = eoaProof.request.params[0] as string;
const validAccountProof = eoaProof.dependentRequests[0].response.result as unknown as ELProof;
const validStateRoot = hexToBuffer(eoaProof.beacon.executionPayload.state_root);

const invalidAccountProof = deepmerge(validAccountProof, {});
delete invalidAccountProof.accountProof[0];

chai.use(chaiAsPromised);

describe("uitls/execution", () => {
  const logger = getEnvLogger();

  describe("isValidAccount", () => {
    it("should return true if account is valid", async () => {
      await expect(
        isValidAccount({
          proof: validAccountProof,
          address,
          stateRoot: validStateRoot,
          logger,
        })
      ).resolves.toBe(true);
    });

    it("should fail with error if proof is valid but address is wrong", async () => {
      const address = "0xe97e180c050e5ab072211ad2c213eb5aee4df134";
      const stateRoot = Buffer.from("7c0f9a6f21d82c2d7690db7aa36c9938de11891071eed6e50ff8b06b5ae7018a", "hex");
      const proof: ELProof = {
        ...validAccountProof,
        address: "0xf97e180c050e5ab072211ad2c213eb5aee4df134",
      };

      await expect(
        isValidAccount({
          proof,
          address,
          stateRoot,
          logger,
        })
      ).resolves.toBe(false);
    });

    it("should fail with error if account is not valid", async () => {
      const address = "0xf97e180c050e5ab072211ad2c213eb5aee4df134";
      const stateRoot = Buffer.from("7c0f9a6f21d82c2d7690db7aa36c9938de11891071eed6e50ff8b06b5ae7018a", "hex");

      await expect(
        isValidAccount({
          proof: invalidAccountProof,
          address,
          stateRoot,
          logger,
        })
      ).resolves.toBe(false);
    });
  });

  describe("isValidStorageKeys", () => {
    it("should return true if storage keys are valid", async () => {
      const storageKeys = ["0xa934b07068f5d95a11413ed6d08a4a1122dc4b8c14a6ab2d94f8b279dac63042"];

      await expect(
        isValidStorageKeys({
          proof: validStorageProof,
          storageKeys,
          logger,
        })
      ).resolves.toBe(true);
    });

    it("should fail with error for a wrong proof", async () => {
      const storageKeys = ["0xa934b07068f5d95a11413ed6d08a4a1122dc4b8c14a6ab2d94f8b279dac63042"];

      await expect(
        isValidStorageKeys({
          logger,
          proof: invalidStorageProof,
          storageKeys,
        })
      ).resolves.toBe(false);
    });

    it("should fail with error for a non existance key", async () => {
      const proof: ELStorageProof = {
        storageHash: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
        storageProof: [
          {
            key: "0xf97e180c050e5ab072211ad2c213eb5aee4df134",
            value: "0x0",
            proof: [],
          },
        ],
      };
      const storageKeys = ["0xa934b07068f5d95a11413ed6d08a4a1122dc4b8c14a6ab2d94f8b279dac63042"];

      await expect(
        isValidStorageKeys({
          proof,
          storageKeys,
          logger,
        })
      ).resolves.toBe(false);
    });

    it("should return true empty keys", async () => {
      const proof: ELStorageProof = {
        storageHash: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
        storageProof: [],
      };
      const storageKeys: string[] = [];

      await expect(
        isValidStorageKeys({
          proof,
          storageKeys,
          logger,
        })
      ).resolves.toBe(true);
    });
  });
});
