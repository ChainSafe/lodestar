import {expect} from "chai";
import {encodeJwtToken, decodeJwtToken} from "../../../src/eth1/provider/jwt";

describe("ExecutionEngine / jwt", () => {
  it("encode/decode correctly", () => {
    const jwtSecret = Buffer.from(Array.from({length: 32}, () => Math.round(Math.random() * 255)));
    const claim = {iat: Math.floor(new Date().getTime() / 1000)};
    const token = encodeJwtToken(claim, jwtSecret);
    const decoded = decodeJwtToken(token, jwtSecret);
    expect(decoded).to.be.deep.equal(claim, "Invalid encoding/decoding of claim");
  });

  it("encode a claim correctly from a hex key", () => {
    const jwtSecretHex = "7e2d709fb01382352aaf830e755d33ca48cb34ba1c21d999e45c1a7a6f88b193";
    const jwtSecret = Buffer.from(jwtSecretHex, "hex");
    const claim = {iat: 1645551452};
    const token = encodeJwtToken(claim, jwtSecret);
    expect(token).to.be.equal(
      "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE2NDU1NTE0NTJ9.nUDaIyGPgRX76tQ_kDlcIGj4uyFA4lFJGKsD_GHIEzM",
      "Invalid encoding of claim"
    );
  });
});
