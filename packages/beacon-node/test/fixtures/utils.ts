export function generateKey(): Buffer {
  return Buffer.alloc(48, 0xaa);
}

export function generateSignature(): Buffer {
  return Buffer.alloc(96, 0xaa);
}

export interface SignedContainer<T> {
  message: T;
  signature: Uint8Array;
}
export function signContainer<T>(container: T): SignedContainer<T> {
  return {
    message: container,
    signature: generateSignature(),
  };
}
