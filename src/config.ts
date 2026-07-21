import { readFileSync } from "node:fs";

export interface RelayConfig {
  listenHost: "127.0.0.1" | "::1";
  listenPort: number;
  allowedOrigins: string[];
  bearerTokenPath: string;
  stateDbPath: string;
  repositoryRoot: string;
  pythonExecutable: string;
  helperPath: string;
  nativeHostName: string;
  extensionId: string;
  requestDeadlineMs: number;
}

export function validateConfig(value: unknown): RelayConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CONFIG_INVALID:object");
  }
  const config = value as Record<string, unknown>;
  if (config.listenHost !== "127.0.0.1" && config.listenHost !== "::1") {
    throw new Error("CONFIG_INVALID:listenHost");
  }
  if (!Number.isInteger(config.listenPort) || (config.listenPort as number) < 1 || (config.listenPort as number) > 65535) {
    throw new Error("CONFIG_INVALID:listenPort");
  }
  if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.some((origin) => typeof origin !== "string")) {
    throw new Error("CONFIG_INVALID:allowedOrigins");
  }
  for (const key of ["bearerTokenPath", "stateDbPath", "repositoryRoot", "pythonExecutable", "helperPath", "nativeHostName", "extensionId"]) {
    if (typeof config[key] !== "string" || (config[key] as string).length === 0) {
      throw new Error(`CONFIG_INVALID:${key}`);
    }
  }
  if (!Number.isInteger(config.requestDeadlineMs) || (config.requestDeadlineMs as number) < 1_000 || (config.requestDeadlineMs as number) > 300_000) {
    throw new Error("CONFIG_INVALID:requestDeadlineMs");
  }
  return config as unknown as RelayConfig;
}

export function loadConfig(path: string): RelayConfig {
  return validateConfig(JSON.parse(readFileSync(path, "utf8")));
}
