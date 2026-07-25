[CmdletBinding()]
param(
  [string]$Destination = (Join-Path $env:TEMP "colapso-public-release"),
  [string]$GitHubLogin = "jpablortiz96",
  [string]$GitHubUserId = "75102646"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version Latest

$RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$Destination = [IO.Path]::GetFullPath($Destination)
$TempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$ExpectedInternalCount = 27
$ExactInternalFiles = @(
  "AGENTS.md",
  "docs/DECISIONS.md",
  "docs/ENVIRONMENT.md",
  "docs/F1_EXECUTION_LOG.md",
  "docs/KIRO_WORKFLOW.md",
  "docs/MANUAL_ACTIONS.md",
  "docs/TASKBOARD.md"
)
$NoreplyEmail = "$GitHubUserId+$GitHubLogin@users.noreply.github.com"

function Invoke-Git([string]$WorkingDirectory, [string[]]$Arguments) {
  $output = & git -C $WorkingDirectory @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments[0]) failed: $($output | Out-String)"
  }
  return @($output)
}

function Invoke-Node([string]$WorkingDirectory, [string[]]$Arguments) {
  Push-Location $WorkingDirectory
  try {
    & node @Arguments
    if ($LASTEXITCODE -ne 0) { throw "node $($Arguments -join ' ') failed with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git is required." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required." }
if (-not $Destination.StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Destination must remain below the operating-system temporary directory."
}
if ($Destination -eq $TempRoot.TrimEnd([IO.Path]::DirectorySeparatorChar)) { throw "Destination cannot be the temporary-directory root." }
if ($Destination -eq $RepositoryRoot -or $RepositoryRoot.StartsWith(($Destination.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) {
  throw "Destination cannot contain or equal the private repository."
}
if ($GitHubLogin -notmatch "^[A-Za-z0-9-]+$" -or $GitHubUserId -notmatch "^\d+$") { throw "GitHub identity parameters are invalid." }

$status = (Invoke-Git -WorkingDirectory $RepositoryRoot -Arguments @("status", "--porcelain") | Out-String).Trim()
if (-not [string]::IsNullOrWhiteSpace($status)) { throw "The private repository must be clean before building the public mirror." }

$trackedFiles = @(Invoke-Git -WorkingDirectory $RepositoryRoot -Arguments @("ls-files") | ForEach-Object { ([string]$_).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$internalFiles = @($trackedFiles | Where-Object { $_.StartsWith(".kiro/") -or $ExactInternalFiles -contains $_ })
if ($internalFiles.Count -ne $ExpectedInternalCount) {
  throw "Expected exactly $ExpectedInternalCount approved internal exclusions, found $($internalFiles.Count)."
}
$publicFiles = @($trackedFiles | Where-Object { $internalFiles -notcontains $_ })
if ($publicFiles.Count -eq 0) { throw "No public files were selected." }

if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null

foreach ($relativePath in $publicFiles) {
  $source = Join-Path $RepositoryRoot ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Tracked source file is missing: $relativePath" }
  $item = Get-Item -LiteralPath $source
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Symbolic links/reparse points are not allowed: $relativePath" }
  $target = Join-Path $Destination ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
  $targetDirectory = Split-Path -Parent $target
  if (-not (Test-Path -LiteralPath $targetDirectory)) { New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null }
  Copy-Item -LiteralPath $source -Destination $target
}

$forbidden = @(
  ".kiro", "AGENTS.md", "docs/DECISIONS.md", "docs/ENVIRONMENT.md", "docs/F1_EXECUTION_LOG.md",
  "docs/KIRO_WORKFLOW.md", "docs/MANUAL_ACTIONS.md", "docs/TASKBOARD.md",
  "deployment/aws-amplify/.deployment-state.json", "deployment/aws-amplify/.staging", "deployment/aws-amplify/releases",
  "frontend/dist", "frontend/coverage", "backend/.venv", "node_modules"
)
foreach ($relativePath in $forbidden) {
  $candidate = Join-Path $Destination ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
  if (Test-Path -LiteralPath $candidate) { throw "Forbidden path entered the public mirror: $relativePath" }
}

Invoke-Git -WorkingDirectory $Destination -Arguments @("init", "-b", "main") | Out-Null
Invoke-Git -WorkingDirectory $Destination -Arguments @("add", "--all") | Out-Null
Invoke-Node -WorkingDirectory $Destination -Arguments @("scripts/verify-public-repository.mjs")
Invoke-Node -WorkingDirectory $Destination -Arguments @("scripts/verify-public-media.mjs")
Invoke-Node -WorkingDirectory $Destination -Arguments @("scripts/verify-step0.mjs", "--secrets-only")

$SourceCommitDate = (Invoke-Git -WorkingDirectory $RepositoryRoot -Arguments @("show", "-s", "--format=%cI", "HEAD") | Out-String).Trim()
$previousEnvironment = @{
  GIT_AUTHOR_NAME = $env:GIT_AUTHOR_NAME
  GIT_AUTHOR_EMAIL = $env:GIT_AUTHOR_EMAIL
  GIT_AUTHOR_DATE = $env:GIT_AUTHOR_DATE
  GIT_COMMITTER_NAME = $env:GIT_COMMITTER_NAME
  GIT_COMMITTER_EMAIL = $env:GIT_COMMITTER_EMAIL
  GIT_COMMITTER_DATE = $env:GIT_COMMITTER_DATE
}
try {
  $env:GIT_AUTHOR_NAME = $GitHubLogin
  $env:GIT_AUTHOR_EMAIL = $NoreplyEmail
  $env:GIT_AUTHOR_DATE = $SourceCommitDate
  $env:GIT_COMMITTER_NAME = $GitHubLogin
  $env:GIT_COMMITTER_EMAIL = $NoreplyEmail
  $env:GIT_COMMITTER_DATE = $SourceCommitDate
  Invoke-Git -WorkingDirectory $Destination -Arguments @("-c", "user.name=$GitHubLogin", "-c", "user.email=$NoreplyEmail", "commit", "-m", "feat: release COLAPSO quantum game") | Out-Null
} finally {
  foreach ($name in $previousEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
  }
}

Invoke-Node -WorkingDirectory $Destination -Arguments @("scripts/verify-public-repository.mjs", "--require-fresh-history")
$finalStatus = (Invoke-Git -WorkingDirectory $Destination -Arguments @("status", "--porcelain") | Out-String).Trim()
if (-not [string]::IsNullOrWhiteSpace($finalStatus)) { throw "Public mirror is not clean after the root commit." }
$commit = (Invoke-Git -WorkingDirectory $Destination -Arguments @("rev-parse", "HEAD") | Out-String).Trim()
Write-Host "Public mirror created successfully."
Write-Host "Destination: $Destination"
Write-Host "Tracked public files: $($publicFiles.Count)"
Write-Host "Excluded internal files: $($internalFiles.Count)"
Write-Host "Root commit: $commit"
