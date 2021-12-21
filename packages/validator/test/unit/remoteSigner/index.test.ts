import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import fs from "fs";
import {requestKeys, requestSignature, serverUpCheck} from "../../../src/services/utils";
import {fromHexString} from "@chainsafe/ssz";
import {createServer, filename} from "./utils";

chai.use(chaiAsPromised);

describe("Remote Signer", () => {
  const remoteUrl = "http://localhost:9002";
  const publicKeys = [
    "b7354252aa5bce27ab9537fd0158515935f3c3861419e1b4b6c8219b5dbd15fcf907bddf275442f3e32f904f79807a2a",
    "a99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c",
    "b89bebc699769726a318c8e9971bd3171297c61aea4a6578a7a4f94b547dcba5bac16a89108b6b6a1fe3695d1a874a0b",
  ];
  const signingRoot = "0xb6bb8f3765f93f4f1e7c7348479289c9261399a3c6906685e320071a1a13955c";
  const expectedSignature =
    "0xb5d0c01cef3b028e2c5f357c2d4b886f8e374d09dd660cd7dd14680d4f956778808b4d3b2ab743e890fc1a77ae62c3c90d613561b23c6adaeb5b0e288832304fddc08c7415080be73e556e8862a1b4d0f6aa8084e34a901544d5bb6aeed3a612";
  const incorrectPublicKey =
    "a8d4c7c27795a725961317ef5953a7032ed6d83739db8b0e8a72353d1b8b4439427f7efa2c89caa03cc9f28f8cbab8ac";
  const keyNotFoundError = `{"error":"Key not found: ${incorrectPublicKey}"}`;
  // eslint-disable-next-line quotes
  const storageError = `{"error":"Storage error: PermissionDenied"}`;
  const unexpectedError = "No";

  before(function () {
    console.log("B4");
  });

  describe("Successful tests", async () => {
    it("should GET /upcheck successfully", async () => {
      await createServer();
      const response = await serverUpCheck(remoteUrl);
      expect(response).to.deep.equal(true);
    });
    it("should GET /keys successfully", async () => {
      await createServer();
      const keys = await requestKeys(remoteUrl);
      for (let i = 0; i < keys.length; i++) {
        expect(keys[i]).to.deep.equal(publicKeys[i]);
      }
    });
    it("should get correct signature data successfully", async () => {
      await createServer();
      const pubkey = (await requestKeys(remoteUrl))[0];
      const sigBytes = await requestSignature(pubkey, signingRoot, remoteUrl);
      expect(sigBytes).to.deep.equal(fromHexString(expectedSignature));
    });
    it("should throw error if trying to sign data with unavailable public key", async () => {
      await createServer();
      await expect(requestSignature(incorrectPublicKey, signingRoot, remoteUrl)).to.be.rejectedWith(keyNotFoundError);
      await expect(requestSignature(incorrectPublicKey, signingRoot, remoteUrl)).to.not.be.rejectedWith(unexpectedError);
    });
  });

  describe("Storage Permission Errors", () => {
    before(async () => {
      fs.chmod(filename, 0o311, () => {
        return;
      });
    });
    it("should throw error if trying to get keys with no storage access", async () => {
      await createServer();
      let errMessage = "";
      try {
        await requestKeys(remoteUrl);
      } catch (err) {
        errMessage = err as string;
      }
      expect(errMessage).to.deep.equal(storageError);
      expect(errMessage).to.not.equal(unexpectedError);
    });

    it("should throw error if trying to sign with no storage access", async () => {
      await createServer();
      let errMessage = "";
      const signingRoot = "0xb6bb8f3765f93f4f1e7c7348479289c9261399a3c6906685e320071a1a13955c";
      await expect(requestSignature(publicKeys[0], signingRoot, remoteUrl)).to.be.rejectedWith("a");
      try {
        await requestSignature(publicKeys[0], signingRoot, remoteUrl);
      } catch (err) {
        errMessage = err as string;
      }
      expect(errMessage).to.deep.equal(storageError);
      expect(errMessage).to.not.equal(unexpectedError);
    });
    after(function () {
      console.log("should be 2");
      fs.chmod(filename, 0o755, async () => {
        return;
      });
    });
  });
});
