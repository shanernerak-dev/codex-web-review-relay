from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRODUCT_VERSION = "0.3.0"
package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
manifest = json.loads((ROOT / "extension" / "manifest.json").read_text(encoding="utf-8"))
server = (ROOT / "src" / "server.ts").read_text(encoding="utf-8")
contract = json.loads((ROOT / "contracts" / "mcp-tools.schema.json").read_text(encoding="utf-8"))

if package.get("version") != PRODUCT_VERSION:
    raise SystemExit(f"PACKAGE_VERSION_MISMATCH:{package.get('version')}")
if manifest.get("version") != PRODUCT_VERSION:
    raise SystemExit(f"EXTENSION_VERSION_MISMATCH:{manifest.get('version')}")
match = re.search(r'serverInfo:\s*\{name:\s*"codex-web-review-relay",\s*version:\s*"([^"]+)"\}', server)
if not match or match.group(1) != PRODUCT_VERSION:
    raise SystemExit("SERVER_VERSION_MISMATCH")
if contract.get("schema_version", {}).get("major") != 2:
    raise SystemExit("MCP_SCHEMA_MAJOR_MISMATCH")
if contract.get("mcp_protocol_version") != "2025-11-25":
    raise SystemExit("MCP_PROTOCOL_VERSION_MISMATCH")
print(json.dumps({"product_version": PRODUCT_VERSION, "mcp_schema_major": 2, "mcp_protocol_version": "2025-11-25"}))
