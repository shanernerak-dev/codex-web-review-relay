# v0.3.0 migration from repository-bound installations

Older installations may contain `repositoryRoot`, `helperPath`, a producer-owned helper, or a launcher bound to a previous clone path. They are not migrated in place automatically.

1. Download and extract the v0.3.0 native-host Windows asset.
2. Run the installer again with the existing `<InstallRoot>`.
3. Confirm that `<InstallRoot>\runtime\src\cli.ts`, `<InstallRoot>\runtime\contracts`, and `<InstallRoot>\relay_export_helper.py` exist.
4. Confirm that the new `relay.config.json` contains no `repositoryRoot` or `helperPath` and that the native-host manifest points to `<InstallRoot>\codex-web-review-relay.exe`.
5. Update the MCP client to pass an absolute `handoff_file`.
6. Reload the Chrome extension and restart the MCP client, terminal, IDE, or agent session.

Reinstalling rotates `CODEX_WEB_REVIEW_RELAY_TOKEN` and rebuilds the installation configuration. Replace any old Authorization header or token saved manually in Codex TOML or another MCP client. Existing jobs remain in the installation state database when it is preserved, but the client must use the new token for authenticated status lookup.

Producer repositories no longer install or register a helper. They only create a canonical tracked handoff, commit it at the reviewed `HEAD`, and pass its absolute path to the relay. The relay-owned exporter is installed at `<InstallRoot>\relay_export_helper.py`.
