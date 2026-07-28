[CmdletBinding()]
param(
  [string]$AwsProfile = "colapso",
  [string]$AwsRegion = "us-east-1",
  [string]$AppName = "colapso-quantum-game",
  [string]$BranchName = "production",
  [string]$PublicSiteUrl = "",
  [string]$ReleaseZip = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version Latest

$Description = "COLAPSO $([char]0x2014) universo cu$([char]0x00E1)ntico jugable"
$RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$DistPath = Join-Path $RepositoryRoot "frontend/dist"
$RulesPath = Join-Path $PSScriptRoot "spa-rule.json"
$HeadersPath = Join-Path $PSScriptRoot "custom-headers.yml"
$StatePath = Join-Path $PSScriptRoot ".deployment-state.json"
$ReleaseDirectory = Join-Path $PSScriptRoot "releases"
$PackageScript = Join-Path $PSScriptRoot "package-amplify.ps1"

if ([string]::IsNullOrWhiteSpace($ReleaseZip)) {
  $gitStatus = (& git -C $RepositoryRoot status --porcelain --untracked-files=normal | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect the Git working tree before deployment."
  }
  if (-not [string]::IsNullOrWhiteSpace($gitStatus)) {
    throw "A new Amplify release requires a clean committed working tree. Commit or revert all source changes before deployment."
  }
}

function Get-ShortId([string]$Value) {
  if ($Value.Length -le 8) { return "****" }
  return "$($Value.Substring(0, 4))...$($Value.Substring($Value.Length - 4))"
}

function Invoke-AwsJson([string[]]$Arguments) {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = & aws @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    $safeOutput = ($output | Out-String).Trim()
    $safeOutput = $safeOutput -replace "\b\d{12}\b", "************"
    $safeOutput = $safeOutput -replace "https://\S+", "[redacted-url]"
    $safeOutput = $safeOutput -replace "\b(?:AKIA|ASIA)[A-Z0-9]{16}\b", "[redacted-key]"
    throw "AWS CLI command failed: $safeOutput"
  }
  return ($output | Out-String).Trim()
}

function Invoke-Npm([string[]]$Arguments) {
  & npm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

function Write-Utf8Json([string]$Path, [object]$Value) {
  [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
}

function Get-OptionalProperty([object]$Value, [string]$Name) {
  if ($null -eq $Value) { return $null }
  $property = $Value.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Assert-NoEnvironmentVariables([object]$Variables, [string]$Scope) {
  if ($null -ne $Variables -and @($Variables.PSObject.Properties).Count -gt 0) {
    throw "$Scope contains environment variables and cannot be reused safely."
  }
}

function Get-SafeFailureDetail([object]$Job) {
  $details = @()
  foreach ($step in @(Get-OptionalProperty -Value $Job -Name "steps")) {
    $status = [string](Get-OptionalProperty -Value $step -Name "status")
    if ($status -in @("FAILED", "CANCELLED")) {
      $context = [string](Get-OptionalProperty -Value $step -Name "context")
      $stepName = [string](Get-OptionalProperty -Value $step -Name "stepName")
      $context = $context -replace "\b\d{12}\b", "************"
      $context = $context -replace "https://\S+", "[redacted-url]"
      $context = $context -replace "\b(?:AKIA|ASIA)[A-Z0-9]{16}\b", "[redacted-key]"
      $details += "$stepName`: $status $context".Trim()
    }
  }
  return $details
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  throw "AWS CLI v2 is required."
}
if (-not (Test-Path -LiteralPath $RulesPath -PathType Leaf) -or -not (Test-Path -LiteralPath $HeadersPath -PathType Leaf)) {
  throw "spa-rule.json and custom-headers.yml are required."
}

$env:AWS_PROFILE = $AwsProfile
$env:AWS_REGION = $AwsRegion
$env:AWS_DEFAULT_REGION = $AwsRegion
$env:AWS_PAGER = ""

$awsVersion = (& aws --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $awsVersion -notmatch "aws-cli/2\.") {
  throw "AWS CLI v2 validation failed."
}
$configuredRegion = (& aws configure get region --profile $AwsProfile | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $configuredRegion -ne $AwsRegion) {
  throw "Profile $AwsProfile must explicitly configure region $AwsRegion."
}
$callerAccount = (& aws sts get-caller-identity --profile $AwsProfile --region $AwsRegion --query Account --output text | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $callerAccount -notmatch "^\d{12}$") {
  throw "AWS identity validation failed for profile $AwsProfile."
}
Write-Host "AWS preflight passed for profile '$AwsProfile' in '$AwsRegion' (identity masked)."

$packageResult = $null
if ([string]::IsNullOrWhiteSpace($ReleaseZip)) {
  Push-Location $RepositoryRoot
  $previousPublicUrl = $env:VITE_PUBLIC_SITE_URL
  try {
    Invoke-Npm -Arguments @("run", "verify:production")
    if (Test-Path -LiteralPath $DistPath) {
      Remove-Item -LiteralPath $DistPath -Recurse -Force
    }
    if ([string]::IsNullOrWhiteSpace($PublicSiteUrl)) {
      Remove-Item Env:VITE_PUBLIC_SITE_URL -ErrorAction SilentlyContinue
    } else {
      $PublicSiteUrl = $PublicSiteUrl.TrimEnd("/")
      $env:VITE_PUBLIC_SITE_URL = $PublicSiteUrl
    }
    Invoke-Npm -Arguments @("run", "build")
    Invoke-Npm -Arguments @("run", "verify:production")
    $packageOutput = & $PackageScript -RepositoryRoot $RepositoryRoot -DistPath $DistPath -ReleaseDirectory $ReleaseDirectory -PublicSiteUrl $PublicSiteUrl
    if ($LASTEXITCODE -ne 0) { throw "Amplify packaging failed." }
    $packageResult = ($packageOutput | Out-String).Trim() | ConvertFrom-Json
  } finally {
    if ($null -eq $previousPublicUrl) {
      Remove-Item Env:VITE_PUBLIC_SITE_URL -ErrorAction SilentlyContinue
    } else {
      $env:VITE_PUBLIC_SITE_URL = $previousPublicUrl
    }
    Pop-Location
  }
} else {
  $releaseRoot = [IO.Path]::GetFullPath($ReleaseDirectory).TrimEnd("\") + "\"
  $releasePath = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot $ReleaseZip))
  if (-not $releasePath.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Rollback ZIP must be located under deployment/aws-amplify/releases/."
  }
  if (-not (Test-Path -LiteralPath $releasePath -PathType Leaf)) { throw "Rollback ZIP not found." }
  $shaPath = [IO.Path]::ChangeExtension($releasePath, ".sha256")
  if (-not (Test-Path -LiteralPath $shaPath -PathType Leaf)) { throw "Rollback SHA-256 sidecar not found." }
  $expectedHash = ((Get-Content -LiteralPath $shaPath -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
  $actualHash = (Get-FileHash -LiteralPath $releasePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expectedHash -ne $actualHash) { throw "Rollback ZIP SHA-256 mismatch." }
  $packageResult = [pscustomobject]@{ zipPath = $releasePath; sha256 = $actualHash; originCommit = "rollback" }
  Write-Host "Validated rollback package $([IO.Path]::GetFileName($releasePath))."
}

$rulesArgument = "file://$($RulesPath.Replace('\', '/'))"
$headersArgument = "file://$($HeadersPath.Replace('\', '/'))"
$appCount = [int]((& aws amplify list-apps --profile $AwsProfile --region $AwsRegion --query "length(apps[?name=='$AppName'])" --output text | Out-String).Trim())
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect existing Amplify apps." }
if ($appCount -gt 1) { throw "Multiple Amplify apps named '$AppName' exist in $AwsRegion; no resource was modified." }

$appId = $null
if ($appCount -eq 0) {
  throw "Existing Amplify app '$AppName' was not found in $AwsRegion; no application will be created."
} else {
  $appId = (& aws amplify list-apps --profile $AwsProfile --region $AwsRegion --query "apps[?name=='$AppName'].appId | [0]" --output text | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($appId) -or $appId -eq "None") { throw "Unable to resolve the unique Amplify app." }
  $detailsResponse = (Invoke-AwsJson -Arguments @("amplify", "get-app", "--app-id", $appId, "--profile", $AwsProfile, "--region", $AwsRegion, "--output", "json")) | ConvertFrom-Json
  $details = Get-OptionalProperty -Value $detailsResponse -Name "app"
  if ($null -eq $details) { throw "Amplify get-app returned no app details." }
  $repository = [string](Get-OptionalProperty -Value $details -Name "repository")
  if ([string](Get-OptionalProperty -Value $details -Name "platform") -ne "WEB" -or -not [string]::IsNullOrWhiteSpace($repository)) {
    throw "Existing app $(Get-ShortId $appId) is not an unconnected static WEB app."
  }
  Assert-NoEnvironmentVariables -Variables (Get-OptionalProperty -Value $details -Name "environmentVariables") -Scope "Existing app"
  $tags = Get-OptionalProperty -Value $details -Name "tags"
  if ([string](Get-OptionalProperty -Value $tags -Name "Project") -ne "COLAPSO" -or [string](Get-OptionalProperty -Value $tags -Name "Environment") -ne "production" -or [string](Get-OptionalProperty -Value $tags -Name "ManagedBy") -ne "Kiro") {
    throw "Existing app $(Get-ShortId $appId) does not carry the required COLAPSO ownership tags."
  }
  $null = Invoke-AwsJson -Arguments @(
    "amplify", "update-app",
    "--app-id", $appId,
    "--name", $AppName,
    "--description", $Description,
    "--platform", "WEB",
    "--no-enable-branch-auto-build",
    "--no-enable-branch-auto-deletion",
    "--no-enable-basic-auth",
    "--custom-rules", $rulesArgument,
    "--custom-headers", $headersArgument,
    "--no-enable-auto-branch-creation",
    "--profile", $AwsProfile,
    "--region", $AwsRegion,
    "--output", "json"
  )
  Write-Host "Reused Amplify app '$AppName' ($(Get-ShortId $appId))."
}

$branchCount = [int]((& aws amplify list-branches --app-id $appId --profile $AwsProfile --region $AwsRegion --query "length(branches[?branchName=='$BranchName'])" --output text | Out-String).Trim())
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect Amplify branches." }
if ($branchCount -gt 1) { throw "Multiple branches named '$BranchName' were returned; no deployment was started." }
if ($branchCount -eq 0) {
  $null = Invoke-AwsJson -Arguments @(
    "amplify", "create-branch",
    "--app-id", $appId,
    "--branch-name", $BranchName,
    "--description", "COLAPSO production static hosting",
    "--stage", "PRODUCTION",
    "--framework", "Web",
    "--no-enable-notification",
    "--no-enable-auto-build",
    "--no-enable-basic-auth",
    "--no-enable-performance-mode",
    "--profile", $AwsProfile,
    "--region", $AwsRegion,
    "--output", "json"
  )
  Write-Host "Created Amplify branch '$BranchName' without Git integration or basic auth."
} else {
  $branchResponse = (Invoke-AwsJson -Arguments @("amplify", "get-branch", "--app-id", $appId, "--branch-name", $BranchName, "--profile", $AwsProfile, "--region", $AwsRegion, "--output", "json")) | ConvertFrom-Json
  $branch = Get-OptionalProperty -Value $branchResponse -Name "branch"
  if ($null -eq $branch) { throw "Amplify get-branch returned no branch details." }
  Assert-NoEnvironmentVariables -Variables (Get-OptionalProperty -Value $branch -Name "environmentVariables") -Scope "Existing branch"
  $backendArn = [string](Get-OptionalProperty -Value $branch -Name "backendEnvironmentArn")
  $backend = Get-OptionalProperty -Value $branch -Name "backend"
  $hasBackend = $null -ne $backend -and @($backend.PSObject.Properties).Count -gt 0
  if (-not [string]::IsNullOrWhiteSpace($backendArn) -or $hasBackend) {
    throw "Existing branch has an Amplify backend and cannot be reused for F6."
  }
  $null = Invoke-AwsJson -Arguments @(
    "amplify", "update-branch",
    "--app-id", $appId,
    "--branch-name", $BranchName,
    "--description", "COLAPSO production static hosting",
    "--framework", "Web",
    "--stage", "PRODUCTION",
    "--no-enable-notification",
    "--no-enable-auto-build",
    "--no-enable-basic-auth",
    "--no-enable-performance-mode",
    "--profile", $AwsProfile,
    "--region", $AwsRegion,
    "--output", "json"
  )
  Write-Host "Reused Amplify branch '$BranchName' with basic auth disabled."
}

$zipPath = [IO.Path]::GetFullPath([string]$packageResult.zipPath)
$terminalStatus = $null
$jobId = $null
for ($attempt = 1; $attempt -le 2; $attempt += 1) {
  $deployment = ((Invoke-AwsJson -Arguments @("amplify", "create-deployment", "--app-id", $appId, "--branch-name", $BranchName, "--profile", $AwsProfile, "--region", $AwsRegion, "--output", "json")) | ConvertFrom-Json)
  $jobId = [string]$deployment.jobId
  $uploadUrl = [string]$deployment.zipUploadUrl
  if ([string]::IsNullOrWhiteSpace($jobId) -or [string]::IsNullOrWhiteSpace($uploadUrl)) { throw "Amplify did not return a deployment upload target." }
  $null = Invoke-WebRequest -Uri $uploadUrl -Method Put -InFile $zipPath -ContentType "application/zip" -UseBasicParsing
  $uploadUrl = $null
  $null = Invoke-AwsJson -Arguments @("amplify", "start-deployment", "--app-id", $appId, "--branch-name", $BranchName, "--job-id", $jobId, "--profile", $AwsProfile, "--region", $AwsRegion, "--output", "json")
  Write-Host "Started Amplify deployment job $jobId (attempt $attempt/2)."

  $terminalStatus = $null
  for ($poll = 0; $poll -lt 180; $poll += 1) {
    $job = ((Invoke-AwsJson -Arguments @("amplify", "get-job", "--app-id", $appId, "--branch-name", $BranchName, "--job-id", $jobId, "--profile", $AwsProfile, "--region", $AwsRegion, "--output", "json")) | ConvertFrom-Json).job
    $status = [string]$job.summary.status
    if ($status -in @("SUCCEED", "FAILED", "CANCELLED")) {
      $terminalStatus = $status
      if ($status -ne "SUCCEED") {
        foreach ($detail in @(Get-SafeFailureDetail -Job $job)) { Write-Warning $detail }
      }
      break
    }
    Start-Sleep -Seconds 5
  }
  if ($null -eq $terminalStatus) { throw "Deployment job $jobId did not reach a terminal state within 15 minutes." }
  if ($terminalStatus -eq "SUCCEED") { break }
  if ($attempt -eq 1) { Write-Warning "Deployment job $jobId ended as $terminalStatus; retrying once on the same app and branch." }
}
if ($terminalStatus -ne "SUCCEED") { throw "Amplify deployment ended as $terminalStatus after at most two attempts." }

$app = ((Invoke-AwsJson -Arguments @("amplify", "get-app", "--app-id", $appId, "--profile", $AwsProfile, "--region", $AwsRegion, "--output", "json")) | ConvertFrom-Json).app
$publicUrl = "https://$BranchName.$($app.defaultDomain)".TrimEnd("/")
$reachable = $false
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  try {
    $response = Invoke-WebRequest -Uri "$publicUrl/" -UseBasicParsing -MaximumRedirection 5 -TimeoutSec 30
    if ([int]$response.StatusCode -eq 200) { $reachable = $true; break }
  } catch {
    Start-Sleep -Seconds 5
  }
}
if (-not $reachable) { throw "Deployment succeeded but the public URL did not return HTTP 200 within the availability window." }

$originCommit = (& git -C $RepositoryRoot rev-parse HEAD).Trim()
$state = [pscustomobject][ordered]@{
  schemaVersion = 1
  region = $AwsRegion
  profile = $AwsProfile
  appId = $appId
  appName = $AppName
  branch = $BranchName
  url = $publicUrl
  lastJob = $jobId
  lastStatus = $terminalStatus
  timestampUtc = [DateTime]::UtcNow.ToString("o")
  originCommit = $originCommit
}
Write-Utf8Json -Path $StatePath -Value $state
Write-Host "Amplify deployment SUCCEED."
Write-Host "Public URL: $publicUrl"
Write-Host "State saved locally without credentials or presigned URLs."
$state | Select-Object region, appName, branch, url, lastJob, lastStatus, timestampUtc, originCommit | ConvertTo-Json
