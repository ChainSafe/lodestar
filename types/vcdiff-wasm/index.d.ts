declare module "vcdiff-wasm" {
  export default async function (): Promise<{
    encoder: (s: Uint8Array, i: Uint8Array) => Uint8Array;
    decoder: (s: Uint8Array, i: Uint8Array) => Uint8Array;
  }>;
}
