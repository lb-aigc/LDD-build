[CmdletBinding()]
param(
  [string]$SourceRoot,
  [string]$DestinationRoot,
  [switch]$SyncOnly
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
  Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
  [IO.Path]::GetFullPath($SourceRoot)
}
$PublishRoot = if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
  Join-Path $ProjectRoot '.github-publish'
} else {
  [IO.Path]::GetFullPath($DestinationRoot)
}
$Repository = 'https://github.com/lb-aigc/LDD-build.git'

function Assert-SchemeASource([string]$Root, [string]$Label) {
  $required = @(
    'packages\runtime-package\src\runtime-lifecycle.ts',
    'packages\runtime-package\src\runtime-install-verification.ts',
    '.github\workflows\build-windows.yml'
  )
  foreach ($relative in $required) {
    $path = Join-Path $Root $relative
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "$Label is not the verified Scheme A source package; missing $relative"
    }
  }
  $workflow = Get-Content -LiteralPath (Join-Path $Root '.github\workflows\build-windows.yml') -Raw -Encoding UTF8
  if ($workflow -notmatch 'Smoke-test installed Harness runtime') {
    throw "$Label does not contain the Scheme A Windows smoke gate"
  }
}

function Get-ApprovedSourceFiles([string]$Root) {
  $manifestPath = Join-Path $Root '.ldd-source-files.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'Approved source inventory is missing; use the complete R4 source package.'
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.formatVersion -ne 1) { throw 'Unsupported approved source inventory format.' }
  $files = @($manifest.files)
  if ($files.Count -eq 0) { throw 'Approved source inventory is empty.' }
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($relative in $files) {
    if ($relative -isnot [string] -or [string]::IsNullOrWhiteSpace($relative)) {
      throw 'Approved source inventory contains an invalid path.'
    }
    $segments = $relative -split '/'
    if (
      $relative.Contains('\') -or
      $relative.StartsWith('/') -or
      $relative -match '^[A-Za-z]:' -or
      $segments -contains '' -or
      $segments -contains '.' -or
      $segments -contains '..'
    ) {
      throw "Approved source inventory contains an unsafe path: $relative"
    }
    if (-not $seen.Add($relative)) { throw "Approved source inventory repeats $relative" }
    $source = [IO.Path]::GetFullPath((Join-Path $Root $relative))
    $item = Get-Item -LiteralPath $source -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      continue
    }
    throw "Approved source entry must be a regular file: $relative"
  }
  if (-not $seen.Contains('.ldd-source-files.json')) {
    throw 'Approved source inventory must include itself.'
  }
  return $files
}

function Sync-SourceTree([string]$From, [string]$To) {
  $approved = @(Get-ApprovedSourceFiles $From)
  Get-ChildItem -LiteralPath $To -Force |
    Where-Object { $_.Name -ne '.git' } |
    Remove-Item -Recurse -Force
  foreach ($relative in $approved) {
    $source = Join-Path $From $relative
    $destination = Join-Path $To $relative
    $parent = Split-Path -Parent $destination
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
      New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    Copy-Item -LiteralPath $source -Destination $destination
  }
}

if ($SyncOnly) {
  try {
    Sync-SourceTree $ProjectRoot $PublishRoot
    exit 0
  }
  catch {
    Write-Host "SYNC FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
}

try {
  Assert-SchemeASource $ProjectRoot 'Local source'
  $git = (Get-Command git.exe -ErrorAction Stop).Source
  if (Test-Path -LiteralPath $PublishRoot) {
    Remove-Item -LiteralPath $PublishRoot -Recurse -Force
  }
  & $git clone $Repository $PublishRoot
  if ($LASTEXITCODE -ne 0) { throw 'git.exe clone failed' }

  Sync-SourceTree $ProjectRoot $PublishRoot
  Assert-SchemeASource $PublishRoot 'Synchronized repository'

  & $git -C $PublishRoot config user.name 'LDD Windows Builder'
  & $git -C $PublishRoot config user.email 'l386340171@gmail.com'
  # The approved Harness contains paths hidden by its own release/ ignore rule.
  & $git -C $PublishRoot add --force --all
  $changes = @(& $git -C $PublishRoot status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw 'git.exe status failed' }
  if ($changes.Count -eq 0) {
    Write-Host 'Remote already contains Scheme A; no upload needed.' -ForegroundColor Green
    exit 0
  }
  & $git -C $PublishRoot commit -m 'build: upload LDD 0.2.0 Windows source'
  if ($LASTEXITCODE -ne 0) { throw 'git.exe commit failed' }
  & $git -C $PublishRoot push origin main
  if ($LASTEXITCODE -ne 0) { throw 'git.exe push origin main failed' }
  Write-Host 'Source uploaded. GitHub Actions is now building LDD.' -ForegroundColor Green
  exit 0
}
catch {
  Write-Host "UPLOAD FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
