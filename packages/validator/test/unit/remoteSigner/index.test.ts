import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {interopSecretKeys} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString} from "@chainsafe/ssz";
import {PublicKey, Signature} from "@chainsafe/bls";
import {
  remoteSignerGetKeys,
  remoteSignerPostSignature,
  remoteSignerUpCheck,
} from "../../../src/util/remoteSignerClient";
import {createRemoteSignerServer} from "../../utils/createRemoteSignerServer";

chai.use(chaiAsPromised);

describe("Remote Signer server", () => {
  const port = 38012;
  const remoteSignerUrl = `http://localhost:${port}`;
  let server: ReturnType<typeof createRemoteSignerServer>;
  let pubkeys: PublicKey[];

  before(async () => {
    const secretKeys = interopSecretKeys(8);
    pubkeys = secretKeys.map((secretKey) => secretKey.toPublicKey());
    server = createRemoteSignerServer(secretKeys);
    await server.listen(port);
  });

  after(async () => {
    await server.close();
  });

  it("should GET /upcheck successfully", async () => {
    const response = await remoteSignerUpCheck(remoteSignerUrl);
    expect(response).to.deep.equal(true);
  });

  it("should GET /keys successfully", async () => {
    const pubkeysResponse = await remoteSignerGetKeys(remoteSignerUrl);
    expect(pubkeysResponse).to.deep.equal(pubkeys.map((pubkey) => pubkey.toHex()));
  });

  it("should get correct signature data successfully", async () => {
    const signingRoot = Buffer.alloc(32, 0xaa);
    const signingRootHex = toHexString(signingRoot);

    for (let i = 0; i < pubkeys.length; i++) {
      const pubkey = pubkeys[i];
      const sigHex = await remoteSignerPostSignature(remoteSignerUrl, pubkey.toHex(), signingRootHex);
      const isValid = Signature.fromHex(sigHex).verify(pubkey, signingRoot);
      expect(isValid).to.equal(true, `Invalid signature for pubkey[${i}]`);
    }
  });

  it("should throw error if trying to sign data with unavailable public key", async () => {
    const signingRoot = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const unknownPubkey =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    await expect(remoteSignerPostSignature(remoteSignerUrl, unknownPubkey, signingRoot)).to.be.rejectedWith(
      `pubkey not known ${unknownPubkey}`
    );
  });
});
