export function getGoerliRpcUrl(): string {
  const {GOERLI_RPC_URL} = process.env;
  if (!GOERLI_RPC_URL) {
    throw Error("Must set ENV GOERLI_RPC_URL");
  }
  return GOERLI_RPC_URL;
}

export const goerliRpcUrl =
  process.env.GOERLI_RPC_URL || "https://goerli.infura.io/v3/84842078b09946638c03157f83405213";
