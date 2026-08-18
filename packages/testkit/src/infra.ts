type UnknownRecord = Record<string, unknown>;

const REQUIRED_BINDINGS = {
  postgres: "127.0.0.1:55432:5432",
  redis: "127.0.0.1:56379:6379",
} as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(reason: string): never {
  throw new Error(`local Compose safety violation: ${reason}`);
}

export function assertLocalServiceUrl(raw: string): void {
  const host = new URL(raw).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error(`local infrastructure URL must use loopback, got ${host}`);
  }
}

export function assertSafeLocalComposeModel(model: unknown): void {
  if (!isRecord(model) || !isRecord(model.services)) {
    fail("services must be an object");
  }

  for (const [serviceName, serviceValue] of Object.entries(model.services)) {
    if (!isRecord(serviceValue)) {
      fail(`service ${serviceName} must be an object`);
    }
    if (serviceValue.restart !== undefined) {
      fail(`service ${serviceName} must not set an automatic restart policy`);
    }
    if (serviceValue.ports !== undefined) {
      if (!Array.isArray(serviceValue.ports) || serviceValue.ports.length === 0) {
        fail(`service ${serviceName} ports must be a non-empty array`);
      }
      for (const binding of serviceValue.ports) {
        if (typeof binding !== "string" || !binding.startsWith("127.0.0.1:")) {
          fail(`service ${serviceName} must bind published ports to 127.0.0.1`);
        }
      }
    }
  }

  for (const [serviceName, expectedBinding] of Object.entries(REQUIRED_BINDINGS)) {
    const service = model.services[serviceName];
    if (!isRecord(service) || !Array.isArray(service.ports)) {
      fail(`service ${serviceName} is missing its required port binding`);
    }
    if (service.ports.length !== 1 || service.ports[0] !== expectedBinding) {
      fail(`service ${serviceName} must publish exactly ${expectedBinding}`);
    }
  }

  const postgres = model.services.postgres;
  const postgresEnvironment = isRecord(postgres) ? postgres.environment : undefined;
  const postgresPassword = isRecord(postgresEnvironment)
    ? postgresEnvironment.POSTGRES_PASSWORD
    : undefined;
  if (
    typeof postgresPassword !== "string" ||
    !/^\$\{ORGSPACE_LOCAL_POSTGRES_PASSWORD:\?[^}]*\}$/.test(postgresPassword)
  ) {
    fail("PostgreSQL password must be supplied through a required environment variable");
  }

  if (!isRecord(model.volumes)) {
    fail("named volumes must be declared");
  }
  for (const volume of ["postgres-data", "redis-data"]) {
    if (!(volume in model.volumes)) {
      fail(`named volume ${volume} is required`);
    }
  }
}
