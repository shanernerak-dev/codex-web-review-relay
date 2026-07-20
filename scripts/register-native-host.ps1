[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string]$ManifestPath,

    [ValidateSet('Chrome', 'Chromium')]
    [string]$Browser = 'Chrome',

    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$resolvedManifest = [System.IO.Path]::GetFullPath($ManifestPath)
if (-not (Test-Path -LiteralPath $resolvedManifest -PathType Leaf)) {
    throw "Manifest does not exist: $resolvedManifest"
}

$manifest = Get-Content -LiteralPath $resolvedManifest -Raw | ConvertFrom-Json
if ($manifest.name -notmatch '^[a-z0-9_]+(\.[a-z0-9_]+)*$') {
    throw 'Manifest name is invalid.'
}
if ($manifest.type -ne 'stdio') {
    throw 'Manifest type must be stdio.'
}
if (-not [System.IO.Path]::IsPathFullyQualified([string]$manifest.path)) {
    throw 'Manifest host path must be absolute.'
}
if (@($manifest.allowed_origins).Count -ne 1 -or $manifest.allowed_origins[0] -notmatch '^chrome-extension://[a-p]{32}/$') {
    throw 'Manifest must contain exactly one concrete Chrome extension origin.'
}

$vendor = if ($Browser -eq 'Chrome') { 'Google\Chrome' } else { 'Chromium' }
$registryPath = "HKCU:\Software\$vendor\NativeMessagingHosts\$($manifest.name)"
if ($Remove) {
    if ($PSCmdlet.ShouldProcess($registryPath, 'Remove native messaging host registration')) {
        Remove-Item -LiteralPath $registryPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    return
}

if ($PSCmdlet.ShouldProcess($registryPath, "Register manifest $resolvedManifest")) {
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -LiteralPath $registryPath -Value $resolvedManifest
}
