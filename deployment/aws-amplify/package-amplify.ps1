[CmdletBinding()]
param(
  [string]$RepositoryRoot,
  [string]$DistPath,
  [string]$ReleaseDirectory,
  [string]$PublicSiteUrl = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
  $RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
}
if ([string]::IsNullOrWhiteSpace($DistPath)) {
  $DistPath = Join-Path $RepositoryRoot "frontend/dist"
}
if ([string]::IsNullOrWhiteSpace($ReleaseDirectory)) {
  $ReleaseDirectory = Join-Path $PSScriptRoot "releases"
}

$RepositoryRoot = [IO.Path]::GetFullPath($RepositoryRoot)
$DistPath = [IO.Path]::GetFullPath($DistPath)
$ReleaseDirectory = [IO.Path]::GetFullPath($ReleaseDirectory)
$stagingRoot = Join-Path $PSScriptRoot ".staging"
$stagingPath = Join-Path $stagingRoot "package"

if (-not (Test-Path -LiteralPath (Join-Path $DistPath "index.html") -PathType Leaf)) {
  throw "frontend/dist/index.html is required before packaging."
}

if (-not [string]::IsNullOrWhiteSpace($PublicSiteUrl)) {
  $parsedUrl = [Uri]$PublicSiteUrl
  if ($parsedUrl.Scheme -ne "https" -or -not [string]::IsNullOrWhiteSpace($parsedUrl.Query) -or -not [string]::IsNullOrWhiteSpace($parsedUrl.Fragment)) {
    throw "PublicSiteUrl must be an HTTPS URL without query or fragment."
  }
  $PublicSiteUrl = $PublicSiteUrl.TrimEnd("/")
}

New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
New-Item -ItemType Directory -Path $ReleaseDirectory -Force | Out-Null
if (Test-Path -LiteralPath $stagingPath) {
  Remove-Item -LiteralPath $stagingPath -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingPath -Force | Out-Null

try {
  Copy-Item -Path (Join-Path $DistPath "*") -Destination $stagingPath -Recurse -Force

  $rootIndex = Join-Path $stagingPath "index.html"
  if (-not (Test-Path -LiteralPath $rootIndex -PathType Leaf)) {
    throw "The staging root does not contain index.html."
  }
  if (Test-Path -LiteralPath (Join-Path $stagingPath "dist")) {
    throw "The package must contain dist contents, never a dist wrapper directory."
  }

  $forbiddenFiles = @(Get-ChildItem -LiteralPath $stagingPath -Recurse -File | Where-Object {
    $_.Extension -eq ".map" -or $_.FullName -match "[\\/](node_modules|src|tests?)[\\/]"
  })
  if ($forbiddenFiles.Count -gt 0) {
    throw "The staging package contains source maps, source, tests, or node_modules."
  }

  $textFiles = @(Get-ChildItem -LiteralPath $stagingPath -Recurse -File | Where-Object { $_.Extension -in @(".html", ".css", ".js", ".json", ".webmanifest") })
  foreach ($file in $textFiles) {
    if (Select-String -LiteralPath $file.FullName -Pattern "localhost|127\.0\.0\.1" -Quiet) {
      throw "The package contains a localhost reference in $($file.Name)."
    }
  }

  $indexContent = Get-Content -LiteralPath $rootIndex -Raw
  if (-not [string]::IsNullOrWhiteSpace($PublicSiteUrl)) {
    $escapedUrl = [Regex]::Escape($PublicSiteUrl)
    if ($indexContent -notmatch ('<link rel="canonical" href="' + $escapedUrl + '"')) {
      throw "The canonical URL in the package does not match PublicSiteUrl."
    }
    if ($indexContent -notmatch ('<meta property="og:url" content="' + $escapedUrl + '"')) {
      throw "The Open Graph URL in the package does not match PublicSiteUrl."
    }
  }

  $commit = (& git -C $RepositoryRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $commit -notmatch "^[0-9a-f]{40}$") {
    throw "Unable to resolve the origin Git commit."
  }
  $timestamp = [DateTime]::UtcNow
  $releaseName = "colapso-$($timestamp.ToString('yyyyMMddTHHmmssfffZ'))-$($commit.Substring(0, 12))"
  $zipPath = Join-Path $ReleaseDirectory "$releaseName.zip"
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
  $writeArchive = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in @(Get-ChildItem -LiteralPath $stagingPath -Recurse -File)) {
      $relativePath = $file.FullName.Substring($stagingPath.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($writeArchive, $file.FullName, $relativePath, [IO.Compression.CompressionLevel]::Optimal)
    }
  } finally {
    $writeArchive.Dispose()
  }

  $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $rawEntries = @($archive.Entries | ForEach-Object { $_.FullName })
    if (@($rawEntries | Where-Object { $_.Contains("\") }).Count -gt 0) {
      throw "The ZIP contains non-portable backslash entry names."
    }
    $entries = @($rawEntries | ForEach-Object { $_.Replace("\", "/") })
  } finally {
    $archive.Dispose()
  }
  if ($entries -notcontains "index.html") {
    throw "The ZIP does not contain index.html at its root."
  }
  if (@($entries | Where-Object { $_ -match "^dist/" }).Count -gt 0) {
    throw "The ZIP incorrectly wraps files in dist/."
  }
  if (@($entries | Where-Object { $_ -match "\.map$|(^|/)(node_modules|src|tests?)/" }).Count -gt 0) {
    throw "The ZIP contains forbidden development files."
  }

  $sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $shaPath = Join-Path $ReleaseDirectory "$releaseName.sha256"
  $metadataPath = Join-Path $ReleaseDirectory "$releaseName.json"
  [IO.File]::WriteAllText($shaPath, "$sha256  $([IO.Path]::GetFileName($zipPath))`n", [Text.UTF8Encoding]::new($false))
  $metadata = [ordered]@{
    schemaVersion = 1
    file = [IO.Path]::GetFileName($zipPath)
    sha256 = $sha256
    bytes = (Get-Item -LiteralPath $zipPath).Length
    entryCount = $entries.Count
    timestampUtc = $timestamp.ToString("o")
    originCommit = $commit
    publicSiteUrl = if ([string]::IsNullOrWhiteSpace($PublicSiteUrl)) { $null } else { $PublicSiteUrl }
  }
  [IO.File]::WriteAllText($metadataPath, ($metadata | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))

  $releases = @(Get-ChildItem -LiteralPath $ReleaseDirectory -Filter "colapso-*.zip" -File | Sort-Object LastWriteTimeUtc -Descending)
  foreach ($oldRelease in @($releases | Select-Object -Skip 3)) {
    $base = [IO.Path]::Combine($oldRelease.DirectoryName, [IO.Path]::GetFileNameWithoutExtension($oldRelease.Name))
    foreach ($candidate in @($oldRelease.FullName, "$base.sha256", "$base.json")) {
      if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Force }
    }
  }

  [ordered]@{
    zipPath = $zipPath
    sha256 = $sha256
    metadataPath = $metadataPath
    entryCount = $entries.Count
    rootIndex = $true
    hasDistWrapper = $false
    hasSourceMaps = $false
    originCommit = $commit
    timestampUtc = $timestamp.ToString("o")
  } | ConvertTo-Json -Compress
} finally {
  if (Test-Path -LiteralPath $stagingPath) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
  }
}
