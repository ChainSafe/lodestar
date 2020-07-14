/**
 * Format a default value in yargs description without actually assigning a default value
 * Some commands require to not be assigned a default value in the yargs build stage,
 * but users should get an idea of what the value will be.
 * @param description "Some description"
 * @param defaultValue "$figurative/$value"
 * @returns 
 * `Some description
 * [default: $figurative/$value]`
 */
export function withDefaultValue(description: string, defaultValue: string): string {
  return `${description} \n[default: ${defaultValue}]`;
}