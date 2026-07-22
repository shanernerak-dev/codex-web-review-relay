import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { RelayConfig } from "./config.ts";
import { validateRelayExport, type RelayExport } from "./relay-contract.ts";

const execFileAsync = promisify(execFile);

async function resolveRepositoryHelper(config: RelayConfig): Promise<{repositoryRoot: string; helper: string}> {
  let repositoryRoot: string;
  let helper: string;
  try {
    repositoryRoot = await realpath(config.repositoryRoot);
    helper = await realpath(resolve(repositoryRoot, config.helperPath));
  } catch {
    throw new Error("RELAY_HELPER_PATH_INVALID");
  }
  const relativeHelper = relative(repositoryRoot, helper);
  if (!relativeHelper || isAbsolute(relativeHelper) || relativeHelper === ".." || relativeHelper.startsWith(`..${sep}`)) {
    throw new Error("RELAY_HELPER_PATH_ESCAPE");
  }
  try {
    if (!(await stat(helper)).isFile()) throw new Error("not a file");
  } catch {
    throw new Error("RELAY_HELPER_PATH_INVALID");
  }
  return {repositoryRoot, helper};
}

export async function runRelayExport(config: RelayConfig, handoffPath: string): Promise<RelayExport> {
  const {repositoryRoot, helper} = await resolveRepositoryHelper(config);
  let stdout: string;
  try {
    ({stdout} = await execFileAsync(
      config.pythonExecutable,
      [helper, "relay-export", handoffPath],
      {
        cwd: repositoryRoot,
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
