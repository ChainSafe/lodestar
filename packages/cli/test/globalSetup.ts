export async function setup(): Promise<void> {
  process.env.NODE_ENV = "test";
}
export async function teardown(): Promise<void> {}
