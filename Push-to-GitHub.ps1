[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PublishRoot = Join-Path $ProjectRoot '.github-publish'
$Repository = 'https://github.com/lb-aigc/LDD-build.git'

try {
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

  & $git -C $PublishRoot config user.name 'LDD Windows Builder'
  & $git -C $PublishRoot config user.email 'l386340171@gmail.com'
  & $git -C $PublishRoot add --all
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
