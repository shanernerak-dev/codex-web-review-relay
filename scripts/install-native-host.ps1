[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)] [string]$InstallRoot,
    [string]$NodeExecutable = 'node',
    [string]$PythonExecutable = 'python',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$hostName = 'dev.shanernerak.codex_web_review_relay'
$extensionId = 'kkdijpckhlminpolkllmmkldlljakfem'
$tokenEnvVar = 'CODEX_WEB_REVIEW_RELAY_TOKEN'
$install = [System.IO.Path]::GetFullPath($InstallRoot)
$companion = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$register = Join-Path $PSScriptRoot 'register-native-host.ps1'
$manifestPath = Join-Path $install 'native-host-manifest.json'

if ($Remove) {
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) { & $register -ManifestPath $manifestPath -Remove }
    [Environment]::SetEnvironmentVariable($tokenEnvVar, $null, 'User')
    if ((Test-Path -LiteralPath $install -PathType Container) -and $PSCmdlet.ShouldProcess($install, 'Remove review relay user-local installation')) { Remove-Item -LiteralPath $install -Recurse -Force }
    return
}

$node = (Get-Command $NodeExecutable -ErrorAction Stop).Source
$python = (Get-Command $PythonExecutable -ErrorAction Stop).Source
if (-not $PSCmdlet.ShouldProcess($install, 'Install review relay native host')) { return }
New-Item -ItemType Directory -Path $install -Force | Out-Null
$principal = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $install /inheritance:r /grant:r "${principal}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict install directory ACL.' }

$tokenPath = Join-Path $install 'bearer-token.txt'
$statePath = Join-Path $install 'state.sqlite'
$diagnosticLogPath = Join-Path $install 'review-relay.events.jsonl'
$exporterPath = Join-Path $install 'relay_export_helper.py'
$configPath = Join-Path $install 'relay.config.json'
$launcherPath = Join-Path $install 'codex-web-review-relay.exe'
$generatedSourcePath = Join-Path $install 'launcher.generated.cs'
$runtimeRoot = Join-Path $install 'runtime'
$runtimeSourcePath = Join-Path $companion 'src'
$runtimeContractsPath = Join-Path $companion 'contracts\mcp-tools.schema.json'
$cliPath = Join-Path $runtimeRoot 'src\cli.ts'
$templatePath = Join-Path $companion 'native-host\launcher.cs.template'
$exporterSourcePath = Join-Path $companion 'scripts\tools\relay_export_helper.py'

function Assert-RegularFile([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -and (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0)) { return }
    throw "Expected a regular file: $Path"
}

Assert-RegularFile $templatePath
Assert-RegularFile $runtimeContractsPath
Assert-RegularFile $exporterSourcePath
if (-not (Test-Path -LiteralPath $runtimeSourcePath -PathType Container)) { throw "Runtime source directory does not exist: $runtimeSourcePath" }
if ((Test-Path -LiteralPath $runtimeRoot) -and $PSCmdlet.ShouldProcess($runtimeRoot, 'Replace installed runtime payload')) {
    Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
Copy-Item -LiteralPath $runtimeSourcePath -Destination $runtimeRoot -Recurse -Force
New-Item -ItemType Directory -Path (Join-Path $runtimeRoot 'contracts') -Force | Out-Null
Copy-Item -LiteralPath $runtimeContractsPath -Destination (Join-Path $runtimeRoot 'contracts\mcp-tools.schema.json') -Force
$runtimePackage = [ordered]@{
    name = 'codex-web-review-relay-native-host'
    version = '0.3.0'
    private = $true
    type = 'module'
    engines = [ordered]@{ node = '>=24' }
}
[System.IO.File]::WriteAllText((Join-Path $runtimeRoot 'package.json'), ($runtimePackage | ConvertTo-Json -Depth 4), [System.Text.UTF8Encoding]::new($false))

$tokenBytes = [byte[]]::new(48)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($tokenBytes)
$tokenText = [Convert]::ToBase64String($tokenBytes)
[System.IO.File]::WriteAllText($tokenPath, $tokenText, [System.Text.UTF8Encoding]::new($false))
[Environment]::SetEnvironmentVariable($tokenEnvVar, $tokenText, 'User')
[System.IO.File]::Copy($exporterSourcePath, $exporterPath, $true)

$config = [ordered]@{
    listenHost = '127.0.0.1'; listenPort = 43127; allowedOrigins = @('http://127.0.0.1:43127')
    bearerTokenPath = $tokenPath; stateDbPath = $statePath
    pythonExecutable = $python
    nativeHostName = $hostName; extensionId = $extensionId
    requestWaitSliceMs = 300000; turnDeadlineMs = 1800000
    diagnosticLogPath = $diagnosticLogPath; diagnosticLogLevel = 'info'
    diagnosticLogMaxBytes = 10485760; diagnosticLogRetainedFiles = 3
}
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 4), [System.Text.UTF8Encoding]::new($false))

function ConvertTo-B64([string]$Value) { [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Value)) }
$source = [System.IO.File]::ReadAllText($templatePath)
$source = $source.Replace('@@NODE_B64@@', (ConvertTo-B64 $node)).Replace('@@CLI_B64@@', (ConvertTo-B64 $cliPath)).Replace('@@CONFIG_B64@@', (ConvertTo-B64 $configPath))
[System.IO.File]::WriteAllText($generatedSourcePath, $source, [System.Text.UTF8Encoding]::new($false))
if (Test-Path -LiteralPath $launcherPath) { Remove-Item -LiteralPath $launcherPath -Force }
$frameworkRoot = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $frameworkRoot 'csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'C# compiler csc.exe was not found.' }
& $compiler /nologo /target:exe "/out:$launcherPath" $generatedSourcePath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) { throw 'Native host launcher compilation failed.' }
Remove-Item -LiteralPath $generatedSourcePath -Force

Assert-RegularFile $cliPath
Assert-RegularFile $exporterPath
$exporterRealPath = [System.IO.Path]::GetFullPath((Get-Item -LiteralPath $exporterPath -Force).FullName)
$exporterRelative = [System.IO.Path]::GetRelativePath($install, $exporterRealPath)
if ([System.IO.Path]::IsPathFullyQualified($exporterRelative) -or $exporterRelative -eq '..' -or $exporterRelative.StartsWith("..\") -or $exporterRelative.StartsWith('../')) {
    throw 'Relay exporter escaped the trusted install root.'
}

$manifest = [ordered]@{ name = $hostName; description = 'Codex Web Review Relay native messaging host'; path = $launcherPath; type = 'stdio'; allowed_origins = @("chrome-extension://$extensionId/") }
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 3), [System.Text.UTF8Encoding]::new($false))
& $register -ManifestPath $manifestPath
[pscustomobject]@{InstallRoot=$install; ExtensionId=$extensionId; ManifestPath=$manifestPath; ConfigPath=$configPath; TokenPath=$tokenPath; TokenEnvVar=$tokenEnvVar}
