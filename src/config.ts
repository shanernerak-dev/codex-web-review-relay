import { readFileSync } from "node:fs";
import { isAbsolute, win32 } from "node:path";
import type { DiagnosticLevel } from "./diagnostic-log.ts";

export interface RelayConfig {
  listenHost: "127.0.0.1" | "::1";
  listenPort: number;
  allowedOrigins: string[];
  bearerTokenPath: string;
  stateDbPath: string;
  pythonExecutable: string;
  exporterPath: string;
  nativeHostName: string;
  extensionId: string;
  requestWaitSliceMs: number;
  turnDeadlineMs: number;
  diagnosticLogPath: string;
  diagnosticLogLevel: DiagnosticLevel;
  diagnosticLogMaxBytes: number;
  diagnosticLogRetainedFiles: number;
}

export function validateConfig(value: unknown): RelayConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("CONFIG_INVALID:object");
  const config = value as Record<string, unknown>;
  if (config.listenHost !== "127.0.0.1" && config.listenHost !== "::1") throw new Error("CONFIG_INVALID:listenHost");
  if (!Number.isInteger(config.listenPort) || (config.listenPort as number) < 1 || (config.listenPort as number) > 65535) throw new Error("CONFIG_INVALID:listenPort");
  if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.some((origin) => typeof origin !== "string")) throw new Error("CONFIG_INVALID:allowedOrigins");
  for (const key of ["bearerTokenPath", "stateDbPath", "pythonExecutable", "exporterPath", "nativeHostName", "extensionId"]) {
    if (typeof config[key] !== "string" || (config[key] as string).length === 0) throw new Error(`CONFIG_INVALID:${key}`);
  }
  const exporterPath = config.exporterPath as string;
  if (exporterPath.includes("\0") || (!isAbsolute(exporterPath) && !win32.isAbsolute(exporterPath))) throw new Error("CONFIG_INVALID:exporterPath");
  if (!Number.isInteger(config.requestWaitSliceMs) || (config.requestWaitSliceMs as number) < 1_000 || (config.requestWaitSliceMs as number) > 300_000) throw new Error("CONFIG_INVALID:requestWaitSliceMs");
  if (!Number.isInteger(config.turnDeadlineMs) || (config.turnDeadlineMs as number) < 300_000 || (config.turnDeadlineMs as number) > 1_800_000) throw new Error("CONFIG_INVALID:turnDeadlineMs");
  if ((config.turnDeadlineMs as number) < (config.requestWaitSliceMs as number)) throw new Error("CONFIG_INVALID:deadlineOrdering");
  const diagnosticLogPath = typeof config.diagnosticLogPath === "string" && config.diagnosticLogPath.length > 0 ? config.diagnosticLogPath : `${config.stateDbPath as string}.events.jsonl`;
  const diagnosticLogLevel = config.diagnosticLogLevel ?? "info";
  if (!["off", "error", "info", "debug", "trace"].includes(diagnosticLogLevel as string)) throw new Error("CONFIG_INVALID:diagnosticLogLevel");
  const diagnosticLogMaxBytes = config.diagnosticLogMaxBytes ?? 10_485_760;
  if (!Number.isInteger(diagnosticLogMaxBytes) || (diagnosticLogMaxBytes as number) < 65_536) throw new Error("CONFIG_INVALID:diagnosticLogMaxBytes");
  const diagnosticLogRetainedFiles = config.diagnosticLogRetainedFiles ?? 3;
  if (!Number.isInteger(diagnosticLogRetainedFiles) || (diagnosticLogRetainedFiles as number) < 1 || (diagnosticLogRetainedFiles as number) > 10) throw new Error("CONFIG_INVALID:diagnosticLogRetainedFiles");
  return {...config, diagnosticLogPath, diagnosticLogLevel, diagnosticLogMaxBytes, diagnosticLogRetainedFiles} as RelayConfig;
}

export function loadConfig(path: string): RelayConfig {
  return validateConfig(JSON.parse(readFileSync(path, "utf8")));
}
