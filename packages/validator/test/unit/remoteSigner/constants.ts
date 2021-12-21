export const remoteUrl = "http://localhost:7890";

export const rootDir = __dirname;

export const publicKeys = [
  "b7354252aa5bce27ab9537fd0158515935f3c3861419e1b4b6c8219b5dbd15fcf907bddf275442f3e32f904f79807a2a",
  "a99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c",
  "b89bebc699769726a318c8e9971bd3171297c61aea4a6578a7a4f94b547dcba5bac16a89108b6b6a1fe3695d1a874a0b",
];
export const signingRoot = "0xb6bb8f3765f93f4f1e7c7348479289c9261399a3c6906685e320071a1a13955c";

export const expectedSignature =
  "0xb5d0c01cef3b028e2c5f357c2d4b886f8e374d09dd660cd7dd14680d4f956778808b4d3b2ab743e890fc1a77ae62c3c90d613561b23c6adaeb5b0e288832304fddc08c7415080be73e556e8862a1b4d0f6aa8084e34a901544d5bb6aeed3a612";

export const incorrectPublicKey =
  "a8d4c7c27795a725961317ef5953a7032ed6d83739db8b0e8a72353d1b8b4439427f7efa2c89caa03cc9f28f8cbab8ac";

export const errorMessages = {
  keyNotFoundError: `{"error":"Key not found: ${incorrectPublicKey}"}`,
  // eslint-disable-next-line prettier/prettier
  storageError: "{\"error\":\"Storage error: PermissionDenied\"}",
  unexpectedError: "No",
};

export const keyPairFileData = `b7354252aa5bce27ab9537fd0158515935f3c3861419e1b4b6c8219b5dbd15fcf907bddf275442f3e32f904f79807a2a,68081afeb7ad3e8d469f87010804c3e8d53ef77d393059a55132637206cc59ec
a99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c,25295f0d1d592a90b333e26e85149708208e9f8e8bc18f6c77bd62f8ad7a6866
b89bebc699769726a318c8e9971bd3171297c61aea4a6578a7a4f94b547dcba5bac16a89108b6b6a1fe3695d1a874a0b,51d0b65185db6989ab0b560d6deed19c7ead0e24b9b6372cbecb1f26bdfad000`;
