import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {validateRelayExport} from "../src/relay-contract.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "compatibility.json"), "utf8"));
const producerRoot = resolve(root, process.env.RELAY_PRODUCER_ROOT ?? "../pwa1483_1d_scan_stress");
const observedHead = execFileSync("git", ["rev-parse", "HEAD"], {cwd: producerRoot, encoding: "utf8"}).trim();
try {
  execFileSync("git", ["merge-base", "--is-ancestor", manifest.producer.commit, observedHead], {cwd: producerRoot});
} catch {
  throw new Error(`PRODUCER_COMMIT_NOT_ANCESTOR:${observedHead}`);
}
const fixture = execFileSync("git", ["show", `${manifest.producer.commit}:${manifest.producer.fixture_path}`], {cwd: producerRoot});
const observedSha256 = createHash("sha256").update(fixture).digest("hex");
if (observedSha256 !== manifest.producer.fixture_sha256) {
  throw new Error(`FIXTURE_SHA256_MISMATCH:${observedSha256}`);
}
const relayExport = validateRelayExport(JSON.parse(fixture.toString("utf8")));
if (relayExport.schema_version.major !== manifest.schema_version.major) {
  throw new Error("SCHEMA_MAJOR_MISMATCH");
}
console.log(JSON.stringify({
  compatible: true,
  producer_commit: manifest.producer.commit,
  observed_head: observedHead,
  fixture_sha256: observedSha256,
  schema_version: relayExport.schema_version
}));
