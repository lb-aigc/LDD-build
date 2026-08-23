[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PublishRoot = Join-Path $ProjectRoot '.github-publish'
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
  $workflow = Get-Content -LiteralPath (Join-Path $Root '.github\workflows\build-windows.yml') -Raw
  if ($workflow -notmatch 'Smoke-test installed Harness runtime') {
    throw "$Label does not contain the Scheme A Windows smoke gate"
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

  $excluded = @('.git', 'node_modules', 'release', 'vendor\runtime-host', '.build-tools', '.build-logs', '.github-publish')
  $arguments = @($ProjectRoot, $PublishRoot, '/E', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD') +
    ($excluded | ForEach-Object { Join-Path $ProjectRoot $_ })
  & robocopy.exe @arguments
  if ($LASTEXITCODE -gt 7) { throw "robocopy failed with exit $LASTEXITCODE" }
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
