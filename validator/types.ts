export interface ValidatorCtx {
  // This key must be hot and used for on-demand signing
  publicKeystore: string;
  // Password for public keystore
  publicKeystorePassword: string;
  // This key can be kept cold and is used upon exit
  withdrawalKeystore: string;
  // Password for withdrawal keystore
  withdrawalKeystorePassword: string;
  // Connection string to RPC
  rpcUrl: string;
}
export const ValidatorCtx = {
  name: "ValidatorCtx",
  fields: [
    ["publicKey", "string"],
    ["withdrawalKey", "string"],
    ["rpcUrl", "string"]
  ],
};
