import {fromHex, getFilledUint8, makeNapiTestSet, makeNapiTestSets, sullyUint8Array} from "../utils";

export const invalidInputs: [string, any][] = [
  ["numbers", 2],
  ["strings", "hello world"],
  ["objects", {testing: 123}],
  ["arrays", ["foo"]],
  ["null", null],
  ["undefined", undefined],
  ["Symbol", Symbol.for("baz")],
  ["Proxy", new Proxy({test: "yo"}, {})],
  ["Uint16Array", new Uint16Array()],
];

export const KEY_MATERIAL = getFilledUint8(32);
export const SECRET_KEY_BYTES = Uint8Array.from(
  Buffer.from("5620799c63c92bb7912122070f7ebb6ddd53bdf9aa63e7a7bffc177f03d14f68", "hex")
);

export const validPublicKey = {
  keygen: "********************************", // Must be at least 32 bytes
  uncompressed: fromHex(
    "0ae7e5822ba97ab07877ea318e747499da648b27302414f9d0b9bb7e3646d248be90c9fdaddfdb93485a6e9334f0109301f36856007e1bc875ab1b00dbf47f9ead16c5562d889d8b270002ade81e78d473204fcb51ede8659bce3d95c67903bc"
  ),
  compressed: fromHex(
    "8ae7e5822ba97ab07877ea318e747499da648b27302414f9d0b9bb7e3646d248be90c9fdaddfdb93485a6e9334f01093"
  ),
};
export const badPublicKey = Uint8Array.from(
  Buffer.from([
    ...Uint8Array.prototype.slice.call(makeNapiTestSet().publicKey.serialize(false), 8),
    ...Buffer.from("0123456789abcdef", "hex"),
  ])
);

export const validSignature = {
  keygen: "********************************", // Must be at least 32 bytes
  uncompressed: fromHex(
    "057565542eaa01ef2b910bf0eaba4d98a1e5b8b79cc425db08f8780732d0ea9bc85fc6175f272b2344bb27bc572ebf14022e52689dcedfccf44a00e5bd1aa59db44517217d6b0f21b372169ee761938c28914ddcb9663de54db288e760a8e14f0f465dc9f94edd3ea43442840e4ef6aeb51d1f77e8e5c5a0fadfb46f186f4644899c7cbefd6ead2b138b030b2914b748051cbab5d38fceb8bea84973ac08d1db5436f177dbcb11d9b7bbb39b6dc32047472f573c64be1d28fd848716c2844f88"
  ),
  compressed: fromHex(
    "a57565542eaa01ef2b910bf0eaba4d98a1e5b8b79cc425db08f8780732d0ea9bc85fc6175f272b2344bb27bc572ebf14022e52689dcedfccf44a00e5bd1aa59db44517217d6b0f21b372169ee761938c28914ddcb9663de54db288e760a8e14f"
  ),
};

export const badSignature = sullyUint8Array(makeNapiTestSet().signature.serialize(false));

export const validSignatureSet = makeNapiTestSets(1).map((set) => {
  const {msg, secretKey, publicKey, signature} = set;
  return {
    msg,
    secretKey,
    publicKey,
    signature,
  };
})[0];
