import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import type { RelayConfig } from "./config.ts";
import { validateRelayExport, type RelayExport } from "./relay-contract.ts";

const execFileAsync = promisify(execFile);

export async function runRelayExport(config: RelayConfig, handoffPath: string): Promise<RelayExport> {
  const helper = resolve(config.repositoryRoot, config.helperPath);
  let stdout: string;
  try {
    ({stdout} = await execFileAsync(
      config.pythonExecutable,
      [helper, "relay-export", handoffPath],
      {
        cwd: config.repositoryRoot,
        timeout: 30_000,
        maxBuffer: 1_048_576,
        windowsHide: true,
        encoding: "utf8",
      },
    ));
  } catch (error) {
    const stderr = typeof (error as {stderr?: unknown}).stderr === "string"
      ? (error as {stderr: string}).stderr.trim().slice(0, 2_000)
      : "relay-export failed";
    throw new Error(`RELAY_EXPORT_FAILED:${stderr}`);
  }
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("RELAY_EXPORT_STDOUT_INVALID");
  }
  return validateRelayExport(JSON.parse(trimmed));
}
