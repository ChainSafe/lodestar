import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {interopSecretKeys} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString} from "@chainsafe/ssz";
import {PublicKey, Signature} from "@chainsafe/bls";
import {
  externalSignerGetKeys,
  externalSignerPostSignature,
  externalSignerUpCheck,
} from "../../../src/util/externalSignerClient";
import {createExternalSignerServer} from "../../utils/createExternalSignerServer";

chai.use(chaiAsPromised);

describe("External signer server", () => {
  const port = 38012;
  const externalSignerUrl = `http://localhost:${port}`;
  let server: ReturnType<typeof createExternalSignerServer>;
  let pubkeys: PublicKey[];

  before(async () => {
    const secretKeys = interopSecretKeys(8);
    pubkeys = secretKeys.map((secretKey) => secretKey.toPublicKey());
    server = createExternalSignerServer(secretKeys);
    await server.listen(port);
  });

  after(async () => {
    await server.close();
  });

  it("should GET /upcheck successfully", async () => {
    const response = await externalSignerUpCheck(externalSignerUrl);
    expect(response).to.deep.equal(true);
  });

  it("should GET /keys successfully", async () => {
    const pubkeysResponse = await externalSignerGetKeys(externalSignerUrl);
    expect(pubkeysResponse).to.deep.equal(pubkeys.map((pubkey) => pubkey.toHex()));
  });

  it("should get correct signature data successfully", async () => {
    const signingRoot = Buffer.alloc(32, 0xaa);
    const signingRootHex = toHexString(signingRoot);

    for (let i = 0; i < pubkeys.length; i++) {
      const pubkey = pubkeys[i];
      const sigHex = await externalSignerPostSignature(externalSignerUrl, pubkey.toHex(), signingRootHex);
      const isValid = Signature.fromHex(sigHex).verify(pubkey, signingRoot);
      expect(isValid).to.equal(true, `Invalid signature for pubkey[${i}]`);
    }
  });

  it("should throw error if trying to sign data with unavailable public key", async () => {
    const signingRoot = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const unknownPubkey =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    await expect(externalSignerPostSignature(externalSignerUrl, unknownPubkey, signingRoot)).to.be.rejectedWith(
      `pubkey not known ${unknownPubkey}`
    );
  });
});
