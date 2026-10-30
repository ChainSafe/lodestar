export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedErrorValue;
  type?: SerializedErrorValue;
};

type SerializedErrorValue =
  | undefined
  | null
  | string
  | number
  | boolean
  | bigint
  | Uint8Array
  | {kind: "error"; value: SerializedError}
  | {kind: "array"; value: SerializedErrorValue[]}
  | {kind: "object"; value: Record<string, SerializedErrorValue>};

export function serializeError(error: Error): SerializedError {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...("cause" in error && {cause: serializeValue(error.cause)}),
    ...("type" in error && {type: serializeValue(error.type)}),
  };
}

export function deserializeError(error: SerializedError): Error {
  const result = new Error(error.message);
  result.name = error.name;
  result.stack = error.stack;
  if ("cause" in error) result.cause = deserializeValue(error.cause);
  if ("type" in error) Object.assign(result, {type: deserializeValue(error.type)});
  return result;
}

function serializeValue(value: unknown): SerializedErrorValue {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      return value;
    case "function":
    case "symbol":
      return String(value);
  }
  if (value instanceof Error) return {kind: "error", value: serializeError(value)};
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (Array.isArray(value)) return {kind: "array", value: value.map(serializeValue)};
  return {
    kind: "object",
    value: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializeValue(entry)])),
  };
}

function deserializeValue(value: SerializedErrorValue): unknown {
  if (value === null || value === undefined || typeof value !== "object" || value instanceof Uint8Array) return value;
  switch (value.kind) {
    case "error":
      return deserializeError(value.value);
    case "array":
      return value.value.map(deserializeValue);
    case "object":
      return Object.fromEntries(Object.entries(value.value).map(([key, entry]) => [key, deserializeValue(entry)]));
  }
}
