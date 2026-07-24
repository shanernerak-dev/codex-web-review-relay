import { execFile } from "node:child_process";
import { lstat, realpath, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, isAbsolute, relative, sep } from "node:path";
import type { RelayConfig } from "./config.ts";
import { validateRelayExport, type RelayExport } from "./relay-contract.ts";

const execFileAsync = promisify(execFile);

async function runGit(repositoryRoot: string, args: string[]): Promise<string> {
  try {
    const {stdout} = await execFileAsync("git", ["-C", repositoryRoot, ...args], {timeout: 10_000, windowsHide: true, encoding: "utf8"});
    return stdout.trim();
  } catch {
    throw new Error("REPOSITORY_IDENTITY_UNAVAILABLE");
  }
}

function parseOriginRepository(origin: string): string {
  const value = origin.trim().replace(/\.git$/, "");
  const match = value.match(/^(?:git@[^:]+:|https?:\/\/[^/]+\/|ssh:\/\/[^/]+\/)([^/]+\/[^/]+)$/);
  if (!match || !/^[^/\s]+\/[^/\s]+$/.test(match[1])) throw new Error("REPOSITORY_IDENTITY_UNAVAILABLE");
  return match[1];
}

export interface HandoffLocation {
  handoffFile: string;
  repositoryRoot: string;
  handoffPath: string;
  repository: string;
}

export async function resolveHandoffLocation(handoffFile: string): Promise<HandoffLocation> {
  if (typeof handoffFile !== "string" || handoffFile.includes("\0") || (!isAbsolute(handoffFile) && !/^[A-Za-z]:[\\/]/.test(handoffFile))) throw new Error("HANDOFF_FILE_INVALID");
  try {
    const resolvedHandoff = await realpath(handoffFile);
    if (!(await stat(resolvedHandoff)).isFile()) throw new Error("invalid file");
    const rootCandidate = await runGit(await realpath(dirname(resolvedHandoff)), ["rev-parse", "--show-toplevel"]);
    const repositoryRoot = await realpath(rootCandidate);
    const relativeInput = relative(repositoryRoot, resolvedHandoff).replaceAll("\\", "/");
    if (!relativeInput || isAbsolute(relativeInput) || relativeInput === ".." || relativeInput.startsWith(`..${sep}`)) throw new Error("escape");
    const trackedPath = await runGit(repositoryRoot, ["ls-files", "--error-unmatch", "--full-name", "--", relativeInput]);
    if (!trackedPath) throw new Error("untracked");
    const repository = parseOriginRepository(await runGit(repositoryRoot, ["remote", "get-url", "origin"]));
    return {handoffFile: resolvedHandoff, repositoryRoot, handoffPath: trackedPath.replaceAll("\\", "/"), repository};
  } catch {
    throw new Error("HANDOFF_LOCATION_INVALID");
  }
}

export async function runRelayExport(config: RelayConfig, handoffFile: string): Promise<RelayExport> {
  const location = await resolveHandoffLocation(handoffFile);
  let helper: string;
  try {
    const trustedRoot = await realpath(config.trustedInstallRoot);
    if (!(await lstat(config.exporterPath)).isFile()) throw new Error("invalid exporter");
    helper = await realpath(config.exporterPath);
    const helperRelative = relative(trustedRoot, helper);
    if (!helperRelative || isAbsolute(helperRelative) || helperRelative === ".." || helperRelative.startsWith(`..${sep}`)) throw new Error("EXPORTER_PATH_ESCAPE");
    if (!(await stat(helper)).isFile()) throw new Error("invalid exporter");
  } catch (error) {
    if (error instanceof Error && error.message === "EXPORTER_PATH_ESCAPE") throw error;
    throw new Error("EXPORTER_PATH_INVALID");
  }
  let stdout: string;
  try {
    ({stdout} = await execFileAsync(config.pythonExecutable, [helper, "relay-export", location.handoffPath], {
      cwd: location.repositoryRoot, timeout: 30_000, maxBuffer: 1_048_576, windowsHide: true, encoding: "utf8",
    }));
  } catch {
    throw new Error("RELAY_EXPORT_FAILED");
  }
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) throw new Error("RELAY_EXPORT_STDOUT_INVALID");
  try {
    const relay = validateRelayExport(JSON.parse(trimmed));
    if (relay.repository !== location.repository || relay.handoff_path !== location.handoffPath) throw new Error("identity mismatch");
    return relay;
  } catch {
    throw new Error("RELAY_EXPORT_INVALID");
  }
}
