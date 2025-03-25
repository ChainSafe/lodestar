import { JSONSchema } from "@apidevtools/json-schema-ref-parser";


export type MethodName = string;

export type MethodDefinition = {
  name: MethodName,
  params: JSONSchema[],
  result: JSONSchema,
}

export type OpenRpcJson = {
  components: JSONSchema, // We don't care what's inside components. Merely for dereferencing
  methods: Record<MethodName, MethodDefinition>,
}


export function parseOpenRpcSpec(openRpcJson: OpenRpcJson): Map<MethodName, MethodDefinition> {
  const methods = new Map<MethodName, MethodDefinition>();
  for (const [methodName, methodDef] of Object.entries(openRpcJson.methods)) {
    methods.set(methodName, methodDef);
  }
  return methods; 
}