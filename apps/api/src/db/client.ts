import postgres from "postgres";

export type DatabaseClient = ReturnType<typeof postgres>;

export function createDatabaseClient(databaseUrl: string): DatabaseClient {
  if (databaseUrl.trim() === "") {
    throw new Error("database URL must not be empty");
  }

  return postgres(databaseUrl, {
    max: 10,
    connect_timeout: 10,
    idle_timeout: 20,
    prepare: false,
  });
}
