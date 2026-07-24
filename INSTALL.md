# v0.3.0 Windows installation

This is the end-user installation guide bundled in the `codex-web-review-relay-native-host-windows-v0.3.0.zip` asset. Download that asset and the extension ZIP from the GitHub Release; cloning the development repository is not required.

## Prerequisites

- Windows
- PowerShell 7 (`pwsh`)
- Node.js `>=24`
- Python `>=3.10`
- Git CLI
- Chrome with Manifest V3 and Native Messaging support
- A system-available .NET Framework C# compiler (`csc.exe`)

The native-host asset does not include Node.js, Python, Git, Chrome, or the C# compiler. Development dependencies and `requirements-dev.txt` are not installation prerequisites.

## Install

1. Extract the native-host ZIP to a temporary directory.
2. From the extracted directory, run:

   ```powershell
   pwsh -NoProfile -File scripts/install-native-host.ps1 -InstallRoot "$env:LOCALAPPDATA\codex-web-review-relay"
   ```

3. Extract the extension ZIP to another directory and load that directory in `chrome://extensions` with **Developer mode** and **Load unpacked**.
4. Open a ChatGPT conversation, click the extension, and manually **Arm** the conversation.
5. Configure the MCP client with the user-level `CODEX_WEB_REVIEW_RELAY_TOKEN` and the local relay endpoint described in the main README.

The installer creates a self-contained runtime under `<InstallRoot>\runtime`. After installation, the downloaded ZIP and its extraction directory may be removed. The launcher uses `<InstallRoot>\runtime\src\cli.ts`, never a Git clone or the extracted source path.

The installer generates a new Bearer token on every install or reinstall. Restart terminals, IDEs, or agent sessions after installation so they receive the new user-level environment variable.

## Request contract

Every MCP request uses an absolute `handoff_file`, for example:

```text
request_review(handoff_file="C:\\absolute\\path\\to\\repo\\.agent\\review_handoffs\\...")
```

The handoff must be tracked, committed, and equal to `HEAD`. The relay resolves the Git root and local `origin` identity for that request. Different repositories can reuse one installation sequentially; two concurrent active jobs are not supported.
