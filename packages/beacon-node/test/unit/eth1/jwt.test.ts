import {describe, it, expect} from "vitest";
import {encodeJwtToken, decodeJwtToken} from "../../../src/eth1/provider/jwt.js";

describe("ExecutionEngine / jwt", () => {
  it("encode/decode correctly", () => {
    const jwtSecret = Buffer.from(Array.from({length: 32}, () => Math.round(Math.random() * 255)));
    const claim = {iat: Math.floor(new Date().getTime() / 1000)};
    const token = encodeJwtToken(claim, jwtSecret);
    const decoded = decodeJwtToken(token, jwtSecret);
    expect(decoded).toEqual(claim);
  });

  it("encode/decode correctly with id and clv", () => {
    const jwtSecret = Buffer.from(Array.from({length: 32}, () => Math.round(Math.random() * 255)));
    const claim = {iat: Math.floor(new Date().getTime() / 1000), id: "4ac0", clv: "v1.11.3"};
    const token = encodeJwtToken(claim, jwtSecret);
    const decoded = decodeJwtToken(token, jwtSecret);
    expect(decoded).toEqual(claim);
  });

  it("encode a claim correctly from a hex key", () => {
    const jwtSecretHex = "7e2d709fb01382352aaf830e755d33ca48cb34ba1c21d999e45c1a7a6f88b193";
    const jwtSecret = Buffer.from(jwtSecretHex, "hex");
    const claim = {iat: 1645551452};
    const token = encodeJwtToken(claim, jwtSecret);
    expect(token).toBe(
      "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE2NDU1NTE0NTJ9.nUDaIyGPgRX76tQ_kDlcIGj4uyFA4lFJGKsD_GHIEzM"
    );
  });

  it("encode a claim with id and clv correctly from a hex key", () => {
    const jwtSecretHex = "7e2d709fb01382352aaf830e755d33ca48cb34ba1c21d999e45c1a7a6f88b193";
    const jwtSecret = Buffer.from(jwtSecretHex, "hex");
    const id = "4ac0";
    const clv = "v1.11.3";
    const claimWithId = {iat: 1645551452, id: id};
    const claimWithVersion = {iat: 1645551452, clv: clv};
    const claimWithIdAndVersion = {iat: 1645551452, id: id, clv: clv};

    const tokenWithId = encodeJwtToken(claimWithId, jwtSecret);
    expect(tokenWithId).toBe(
      "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE2NDU1NTE0NTIsImlkIjoiNGFjMCJ9.w9l76DePA4ghPlrHlLqZ0q5WyEmdfLjV3NJYQHeQ_c4"
    );

    const tokenWithVersion = encodeJwtToken(claimWithVersion, jwtSecret);
    expect(tokenWithVersion).toBe(
      "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE2NDU1NTE0NTIsImNsdiI6InYxLjExLjMifQ.4c1iWrLaR9dnE07PRt6bLwGJ5xtZaUWJ4-RVtz-5Uog"
    );

    const tokenWithIdAndVersion = encodeJwtToken(claimWithIdAndVersion, jwtSecret);
    expect(tokenWithIdAndVersion).toBe(
      "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE2NDU1NTE0NTIsImlkIjoiNGFjMCIsImNsdiI6InYxLjExLjMifQ.tvpnzAUsYpYMdPgauLsISITXzAAP1uuNfHKzVKITNhs"
    );
  });
});
