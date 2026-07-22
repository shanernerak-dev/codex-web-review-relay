import { readFileSync } from "node:fs";
import { isAbsolute, win32 } from "node:path";

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
  requestWaitSliceMs: number;
  turnDeadlineMs: number;
}

function isRepositoryRelativePath(value: string): boolean {
  if (value.includes("\0") || isAbsolute(value) || win32.isAbsolute(value) || /^(?:\\\\|\/\/)/.test(value) || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  return !value.split(/[\\/]+/).some((segment) => segment === "..");
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
  if (!isRepositoryRelativePath(config.helperPath as string)) {
    throw new Error("CONFIG_INVALID:helperPathBoundary");
  }
  if (!Number.isInteger(config.requestWaitSliceMs) || (config.requestWaitSliceMs as number) < 1_000 || (config.requestWaitSliceMs as number) > 300_000) {
    throw new Error("CONFIG_INVALID:requestWaitSliceMs");
  }
  if (!Number.isInteger(config.turnDeadlineMs) || (config.turnDeadlineMs as number) < 300_000 || (config.turnDeadlineMs as number) > 1_800_000) {
    throw new Error("CONFIG_INVALID:turnDeadlineMs");
  }
  if ((config.turnDeadlineMs as number) < (config.requestWaitSliceMs as number)) {
    throw new Error("CONFIG_INVALID:deadlineOrdering");
  }
  return config as unknown as RelayConfig;
}

export function loadConfig(path: string): RelayConfig {
  return validateConfig(JSON.parse(readFileSync(path, "utf8")));
}
