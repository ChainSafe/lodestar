import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import fs from "fs";
import {requestKeys, requestSignature, serverUpCheck} from "../../../src/services/utils";
import {fromHexString} from "@chainsafe/ssz";
import {createServer, filename} from "./utils";
import {errorMessages, expectedSignature, incorrectPublicKey, publicKeys, signingRoot, remoteUrl} from "./constants";

chai.use(chaiAsPromised);

describe("Remote Signer", () => {
  beforeEach(async () => {
    await createServer(8);
  });
  describe("Successful tests", async () => {
    it("should GET /upcheck successfully", async () => {
      const response = await serverUpCheck(remoteUrl);
      expect(response).to.deep.equal(true);
    });
    it("should GET /keys successfully", async () => {
      const keys = await requestKeys(remoteUrl);
      for (let i = 0; i < keys.length; i++) {
        expect(keys[i]).to.deep.equal(publicKeys[i]);
      }
    });
    it("should get correct signature data successfully", async () => {
      const keys = await requestKeys(remoteUrl);
      for (let i = 0; i < keys.length; i++) {
        const sigBytes = await requestSignature(keys[i], signingRoot, remoteUrl);
        expect(sigBytes).to.deep.equal(fromHexString(expectedSignature[i]));
      }
    });
  });

  describe("Storage Permission Errors", () => {
    beforeEach(async () => {
      fs.chmod(filename, 0o311, () => {
        return;
      });
    });
    it("should throw error if trying to get keys with no storage access", async () => {
      let errMessage = "";
      try {
        await requestKeys(remoteUrl);
      } catch (err) {
        errMessage = err as string;
      }
      expect(errMessage).to.deep.equal(errorMessages.storageError);
      expect(errMessage).to.not.equal(errorMessages.unexpectedError);
    });
    it("should throw error if trying to sign with no storage access", async () => {
      let errMessage = "";
      const signingRoot = "0xb6bb8f3765f93f4f1e7c7348479289c9261399a3c6906685e320071a1a13955c";
      try {
        await requestSignature(publicKeys[0], signingRoot, remoteUrl);
      } catch (err) {
        errMessage = err as string;
      }
      expect(errMessage).to.deep.equal(errorMessages.storageError);
      expect(errMessage).to.not.equal(errorMessages.unexpectedError);
    });
  });
  it("should throw error if trying to sign data with unavailable public key", async () => {
    await expect(requestSignature(incorrectPublicKey, signingRoot, remoteUrl)).to.be.rejectedWith(
      errorMessages.keyNotFoundError
    );
    await expect(requestSignature(incorrectPublicKey, signingRoot, remoteUrl)).to.not.be.rejectedWith(
      errorMessages.unexpectedError
    );
  });
});
