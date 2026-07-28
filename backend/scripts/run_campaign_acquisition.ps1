[CmdletBinding(DefaultParameterSetName = "Preflight")]
param(
    [Parameter(Mandatory, ParameterSetName = "Preflight")]
    [switch] $PreflightOnly,

    [Parameter(Mandatory, ParameterSetName = "Submit")]
    [switch] $Submit,

    [Parameter(Mandatory, ParameterSetName = "Resume")]
    [switch] $Resume,

    [Parameter(Mandatory, ParameterSetName = "Poll")]
    [switch] $PollOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$userProfile = [Environment]::GetFolderPath("UserProfile")
if ([string]::IsNullOrWhiteSpace($userProfile)) {
    Write-Error "The user profile is unavailable."
    exit 2
}

$credentialsFile = Join-Path (Join-Path $userProfile ".qiskit") "qiskit-ibm.json"
if (-not (Test-Path -LiteralPath $credentialsFile -PathType Leaf)) {
    Write-Error "The IBM credential store is unavailable."
    exit 2
}

$backendRoot = Split-Path -Parent $PSScriptRoot
$pythonExecutable = Join-Path $backendRoot ".venv\Scripts\python.exe"
$runner = Join-Path $PSScriptRoot "acquire_campaign_quantum_evidence.py"
if (-not (Test-Path -LiteralPath $pythonExecutable -PathType Leaf)) {
    Write-Error "The pinned backend Python environment is unavailable."
    exit 2
}
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
    Write-Error "The campaign acquisition runner is unavailable."
    exit 2
}

$pythonArguments = @(
    $runner
    "--credentials-file"
    $credentialsFile
    "--account-name"
    "colapso"
)

if ($PreflightOnly) {
    $pythonArguments += "--preflight-only"
}
elseif ($Submit) {
    $confirmation = Read-Host 'Type "SUBMIT ONE HARDWARE JOB" to continue'
    if ($confirmation -cne "SUBMIT ONE HARDWARE JOB") {
        Write-Error "Hardware submission was not confirmed."
        exit 2
    }
    $pythonArguments += @("--submit", "--confirm-hardware-submission")
}
elseif ($Resume) {
    $confirmation = Read-Host 'Type "RESUME OR RETRY ONE HARDWARE JOB" to continue'
    if ($confirmation -cne "RESUME OR RETRY ONE HARDWARE JOB") {
        Write-Error "Hardware resume or retry was not confirmed."
        exit 2
    }
    $pythonArguments += @("--resume", "--confirm-hardware-submission")
}
else {
    $pythonArguments += "--poll-only"
}

& $pythonExecutable @pythonArguments
exit $LASTEXITCODE
