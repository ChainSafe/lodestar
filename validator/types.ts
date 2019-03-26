export interface ValidatorCtx {
  // This key must be hot and used for on-demand signing
  publicKeystore: string;
  // Password for public keystore
  publicKeystorePassword: string;
  // Connection string to RPC
  rpcUrl: string;
}
