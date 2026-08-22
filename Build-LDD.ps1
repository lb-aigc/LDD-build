[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ToolsRoot = Join-Path $ProjectRoot '.build-tools'
$DownloadsRoot = Join-Path $ToolsRoot 'downloads'
$BootstrapRoot = Join-Path $ToolsRoot 'node-bootstrap'
$ShimRoot = Join-Path $ToolsRoot 'bin'
$LogsRoot = Join-Path $ProjectRoot '.build-logs'
$ReleaseRoot = Join-Path $ProjectRoot 'release'
$TranscriptPath = Join-Path $LogsRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
$TranscriptPath += '-build.log'
$NativeLogPath = "$TranscriptPath.native.log"

New-Item -ItemType Directory -Force -Path $DownloadsRoot, $ShimRoot, $LogsRoot | Out-Null
Start-Transcript -LiteralPath $TranscriptPath -Force | Out-Null

function Invoke-LddBuild {
try {
  Write-Host 'LDD 0.2.0 Windows x64 build started.' -ForegroundColor Cyan
  Assert-WindowsX64
  Assert-FreeSpace -MinimumBytes 15GB

  $git = Get-Git
  Write-Host "Git: $(& $git --version)"

  $sourcesPath = Join-Path $ProjectRoot 'vendor\runtime-sources.json'
  if (-not (Test-Path -LiteralPath $sourcesPath -PathType Leaf)) {
    throw "Pinned runtime source manifest is missing: $sourcesPath"
  }
  $sources = Get-Content -LiteralPath $sourcesPath -Raw | ConvertFrom-Json
  if ($sources.node.version -ne '24.19.0') {
    throw "Unexpected bootstrap Node version: $($sources.node.version)"
  }

  $bootstrapNode = Get-BootstrapNode -Source $sources.node
  Write-Host "Bootstrap Node: $(& $bootstrapNode --version)"

  Initialize-SourceRepository -Git $git
  & $git -C $ProjectRoot config core.longpaths true
  Assert-LastExitCode 'enabling Git long paths'

  Write-Host 'Preparing checksum-pinned Node, pnpm, FFmpeg and FFprobe...'
  & $bootstrapNode (Join-Path $ProjectRoot 'scripts\prepare-runtime-host.mjs') 2>&1 |
    Tee-Object -FilePath $NativeLogPath -Append
  Assert-LastExitCode 'preparing the LDD runtime host'

  $runtimeNode = Join-Path $ProjectRoot 'vendor\runtime-host\node\node.exe'
  $pnpmEntry = Join-Path $ProjectRoot 'vendor\runtime-host\pnpm\bin\pnpm.cjs'
  Assert-RegularFile $runtimeNode
  Assert-RegularFile $pnpmEntry
  Write-PnpmShim -NodePath $runtimeNode -PnpmPath $pnpmEntry

  $env:Path = "$ShimRoot;$(Split-Path -Parent $runtimeNode);$(Split-Path -Parent $git);$env:Path"
  $pnpmVersion = (& $runtimeNode $pnpmEntry --version | Select-Object -Last 1).Trim()
  Assert-LastExitCode 'checking pnpm'
  if ($pnpmVersion -ne '11.7.0') { throw "Expected pnpm 11.7.0, received $pnpmVersion" }
  Write-Host "pnpm: $pnpmVersion"

  Write-Host 'Installing the locked dependency graph...'
  & $runtimeNode $pnpmEntry install --frozen-lockfile --config.block-exotic-subdeps=false
  Assert-LastExitCode 'installing dependencies'

  Write-Host 'Building Harness runtime, offline updater and NSIS installer...'
  & $runtimeNode $pnpmEntry dist:win
  Assert-LastExitCode 'building the Windows release'

  $required = @(
    'LDD-Setup-0.2.0-x64.exe',
    'deepseek-harness-0.1.1-rc.2-windows-x64.lddruntime',
    'LDD-0.2.0-source.zip',
    'checksums.sha256'
  )
  Write-Host 'Verifying release artifacts...'
  foreach ($name in $required) {
    $path = Join-Path $ReleaseRoot $name
    Assert-RegularFile $path
    $item = Get-Item -LiteralPath $path
    if ($item.Length -le 0) { throw "Release artifact is empty: $path" }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
    Write-Host "$hash  $name"
  }

  Write-Host ''
  Write-Host 'LDD Windows release completed.' -ForegroundColor Green
  Write-Host "Installer: $(Join-Path $ReleaseRoot 'LDD-Setup-0.2.0-x64.exe')"
  Write-Host "Build log: $TranscriptPath"
  exit 0
}
catch {
  Write-Host ''
  Write-Host "BUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Build log: $TranscriptPath"
  exit 1
}
finally {
  try { Stop-Transcript | Out-Null } catch {}
}
}

function Assert-WindowsX64 {
  if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'LDD requires 64-bit Windows 10 or Windows 11.'
  }
  if ($env:OS -ne 'Windows_NT') {
    throw 'This build package must run on Windows.'
  }
}

function Assert-FreeSpace {
  param([Int64]$MinimumBytes)
  $root = [IO.Path]::GetPathRoot($ProjectRoot)
  $drive = Get-PSDrive -Name $root.Substring(0, 1)
  if ($drive.Free -lt $MinimumBytes) {
    $requiredGB = [Math]::Ceiling($MinimumBytes / 1GB)
    $freeGB = [Math]::Round($drive.Free / 1GB, 1)
    throw "At least $requiredGB GB free space is required; $freeGB GB is available."
  }
}

function Get-Git {
  $command = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Git\cmd\git.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
  if ($candidates.Count -gt 0) { return $candidates[0] }

  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw 'Git is not installed and Windows Package Manager is unavailable. Install Git for Windows, then run Build-LDD.cmd again.'
  }
  Write-Host 'Git is missing. Installing Git for Windows with winget...'
  & $winget.Source install --id Git.Git --exact --source winget --accept-package-agreements --accept-source-agreements --silent | Out-Host
  Assert-LastExitCode 'installing Git for Windows'
  foreach ($path in @(
    (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Git\cmd\git.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
  )) {
    if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) { return $path }
  }
  throw 'Git installation completed but git.exe could not be found. Restart Windows and run Build-LDD.cmd again.'
}

function Get-BootstrapNode {
  param($Source)
  $bundledNode = Join-Path $ProjectRoot 'vendor\runtime-host\node\node.exe'
  if (Test-Path -LiteralPath $bundledNode -PathType Leaf) {
    Assert-Sha256 -Path $bundledNode -Expected $Source.executableSha256
    Write-Host 'Using the bundled checksum-pinned Node runtime.'
    return $bundledNode
  }
  $archive = Join-Path $DownloadsRoot "node-v$($Source.version)-win-x64.zip"
  if (Test-Path -LiteralPath $archive -PathType Leaf) {
    Assert-Sha256 -Path $archive -Expected $Source.sha256
  }
  else {
    Write-Host "Downloading Node $($Source.version)..."
    $temporary = "$archive.download"
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    Invoke-WebRequest -Uri $Source.url -OutFile $temporary -UseBasicParsing
    Assert-Sha256 -Path $temporary -Expected $Source.sha256
    Move-Item -LiteralPath $temporary -Destination $archive
  }

  $marker = Join-Path $BootstrapRoot '.archive-sha256'
  $needsExtraction = -not (Test-Path -LiteralPath $marker -PathType Leaf)
  if (-not $needsExtraction) {
    $needsExtraction = (Get-Content -LiteralPath $marker -Raw).Trim() -ne $Source.sha256
  }
  if ($needsExtraction) {
    Remove-Item -LiteralPath $BootstrapRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $BootstrapRoot | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $BootstrapRoot -Force
    Set-Content -LiteralPath $marker -Value $Source.sha256 -Encoding ASCII
  }
  $node = Get-ChildItem -LiteralPath $BootstrapRoot -Filter node.exe -File -Recurse |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $node) { throw 'The verified Node archive did not contain node.exe.' }
  return $node
}

function Initialize-SourceRepository {
  param([string]$Git)
  if (Test-Path -LiteralPath (Join-Path $ProjectRoot '.git')) { return }
  Write-Host 'Initializing the local source snapshot for deterministic packaging...'
  & $Git -C $ProjectRoot init
  Assert-LastExitCode 'initializing the source repository'
  & $Git -C $ProjectRoot config user.name 'LDD Local Builder'
  Assert-LastExitCode 'configuring the local build identity'
  & $Git -C $ProjectRoot config user.email 'local-builder@localhost'
  Assert-LastExitCode 'configuring the local build identity'
  & $Git -C $ProjectRoot add --all
  Assert-LastExitCode 'staging the source snapshot'
  & $Git -C $ProjectRoot commit -m 'LDD 0.2.0 local build snapshot'
  Assert-LastExitCode 'committing the source snapshot'
}

function Write-PnpmShim {
  param([string]$NodePath, [string]$PnpmPath)
  $shim = Join-Path $ShimRoot 'pnpm.cmd'
  $content = "@echo off`r`n`"$NodePath`" `"$PnpmPath`" %*`r`n"
  Set-Content -LiteralPath $shim -Value $content -Encoding ASCII
}

function Assert-Sha256 {
  param([string]$Path, [string]$Expected)
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  if ($actual -ne $Expected.ToLowerInvariant()) {
    throw "SHA-256 mismatch for $Path. Expected $Expected, received $actual."
  }
}

function Assert-RegularFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Required file is missing: $Path"
  }
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "Refusing a link-shaped file: $Path"
  }
}

function Assert-LastExitCode {
  param([string]$Action)
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed while $Action (exit $LASTEXITCODE)."
  }
}

Invoke-LddBuild
