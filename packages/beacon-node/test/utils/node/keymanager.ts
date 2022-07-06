export function getKeystoreForPubKey1(): string {
  return JSON.stringify({
    crypto: {
      kdf: {
        function: "scrypt",
        params: {
          dklen: 32,
          n: 262144,
          r: 8,
          p: 1,
          salt: "87f8e61bd461206ebbb222f2e789322504b6543067a8b49f2c29f35f203a56c5",
        },
        message: "",
      },
      checksum: {
        function: "sha256",
        params: {},
        message: "e3b7f6a0dc99543fa62afd4bcdf2a49b4ee8075609389eaa0bfeeb8987fcf8b8",
      },
      cipher: {
        function: "aes-128-ctr",
        params: {
          iv: "84008836292fbc9bd9efb50d95939cdc",
        },
        message: "b81e6288a4307b8e29f2e952cecc5642e0832ae7123b93306702ec48cdf2f8d9",
      },
    },
    description: "",
    pubkey: "97b1b00d3c1888b5715c2c88bf1df7b0ad715388079de211bdc153697b69b868c671af3b2d86c5cdfbade48d03888ab4",
    path: "m/12381/3600/0/0/0",
    uuid: "537500a4-37ae-48f3-8ac2-2deda5285699",
    version: 4,
  }).trim();
}

export function getKeystoreForPubKey2(): string {
  return JSON.stringify({
    crypto: {
      kdf: {
        function: "scrypt",
        params: {
          dklen: 32,
          n: 262144,
          r: 8,
          p: 1,
          salt: "6e179aeba4e5ac240b326cafe9a5de4ed7c17ac956b3c06537b384a508f5a818",
        },
        message: "",
      },
      checksum: {
        function: "sha256",
        params: {},
        message: "5436d7e035b60c08f9b285a5251ee5f5e2275e44ed161cba4352f1c1da869697",
      },
      cipher: {
        function: "aes-128-ctr",
        params: {
          iv: "7e87e2c3ede5e95aa86df569934b5e5c",
        },
        message: "c06ebc0a02c61be5dafbe59e3d286e762f3b9fe0505176bd5504ed49ef90373a",
      },
    },
    description: "",
    pubkey: "a74e11fd129b9bafc2d6afad4944cd289c238139130a7abafe7b28dde1923a0e4833ad776f9e0d7aaaecd9f0acbfedd3",
    path: "m/12381/3600/0/0/0",
    uuid: "5c0169d3-c132-4581-8e7c-afcbf45000cf",
    version: 4,
  }).trim();
}
