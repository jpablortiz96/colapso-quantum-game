[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Url
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version Latest

$ExpectedTitleTag = "<title>COLAPSO $([char]0x2014) Un universo cu$([char]0x00E1)ntico jugable</title>"
$ExpectedDescription = "Explora un universo generado a partir de evidencia de hardware cu$([char]0x00E1)ntico real."

$BaseUrl = $Url.TrimEnd("/")
$Failures = 0
$Checks = 0

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
  $script:Checks += 1
  if (-not $Passed) { $script:Failures += 1 }
  $prefix = if ($Passed) { "PASS" } else { "FAIL" }
  Write-Host "$prefix  $Name`: $Detail"
}

function Resolve-PublicUrl([string]$Path) {
  if ($Path -match "^https://") { return $Path }
  if (-not $Path.StartsWith("/")) { $Path = "/$Path" }
  return "$script:BaseUrl$Path"
}

function Get-Response([string]$Path) {
  $target = Resolve-PublicUrl $Path
  for ($attempt = 1; $attempt -le 3; $attempt += 1) {
    try {
      return Invoke-WebRequest -Uri $target -UseBasicParsing -MaximumRedirection 5 -TimeoutSec 30
    } catch {
      if ($attempt -eq 3) { throw }
      Start-Sleep -Seconds 2
    }
  }
}

function Get-StatusAllowFailure([string]$Path) {
  try {
    $response = Invoke-WebRequest -Uri (Resolve-PublicUrl $Path) -UseBasicParsing -MaximumRedirection 5 -TimeoutSec 30
    return [int]$response.StatusCode
  } catch {
    if ($null -ne $_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}

function Get-TextContent([object]$Response) {
  if ($null -eq $Response) { return "" }
  $streamProperty = $Response.PSObject.Properties["RawContentStream"]
  if ($null -ne $streamProperty -and $null -ne $streamProperty.Value -and $null -ne $streamProperty.Value.PSObject.Methods["ToArray"]) {
    return [Text.Encoding]::UTF8.GetString($streamProperty.Value.ToArray())
  }
  $contentProperty = $Response.PSObject.Properties["Content"]
  if ($null -eq $contentProperty) { return "" }
  return [string]$contentProperty.Value
}

function Get-Header([object]$Response, [string]$Name) {
  if ($null -eq $Response) { return "" }
  $headersProperty = $Response.PSObject.Properties["Headers"]
  if ($null -eq $headersProperty -or $null -eq $headersProperty.Value) { return "" }
  $value = $headersProperty.Value[$Name]
  if ($null -eq $value) { return "" }
  return [string]$value
}

Write-Host "COLAPSO Amplify post-deployment verification"
Write-Host ("=" * 48)

$parsedBase = $null
try { $parsedBase = [Uri]$BaseUrl } catch { }
Add-Check "HTTPS URL" ($null -ne $parsedBase -and $parsedBase.Scheme -eq "https" -and [string]::IsNullOrWhiteSpace($parsedBase.Query) -and [string]::IsNullOrWhiteSpace($parsedBase.Fragment)) $BaseUrl
if ($Failures -gt 0) { exit 1 }

$root = Get-Response "/"
$html = Get-TextContent -Response $root
Add-Check "Root availability" ([int]$root.StatusCode -eq 200) "HTTP $($root.StatusCode)"
Add-Check "Professional title" ($html.Contains($ExpectedTitleTag)) "Expected Spanish title is present."
Add-Check "Description and theme" ($html.Contains($ExpectedDescription) -and $html.Contains('name="theme-color" content="#06152d"')) "Description and theme-color are present."
Add-Check "Canonical URL" ($html.Contains("<link rel=`"canonical`" href=`"$BaseUrl`" />") -and $html.Contains("<meta property=`"og:url`" content=`"$BaseUrl`" />")) "canonical and og:url match the deployed branch URL."
Add-Check "Social metadata" ($html.Contains('property="og:title"') -and $html.Contains('name="twitter:card"') -and $html.Contains('name="twitter:image"')) "Open Graph and Twitter metadata are present."
Add-Check "No mixed content" ($html -notmatch "http://") "HTML contains no insecure HTTP resource."

$staticPaths = @(
  "/manifest.webmanifest",
  "/assets/colapso/favicon-32.png",
  "/assets/colapso/icon-192.png",
  "/assets/colapso/icon-512.png",
  "/assets/colapso/backgrounds/hero_quantum_bg.webp",
  "/assets/colapso/backgrounds/final_quantum_bg.webp"
)
$staticResponses = @{}
foreach ($path in $staticPaths) {
  try { $staticResponses[$path] = Get-Response $path } catch { $staticResponses[$path] = $null }
}
Add-Check "Identity and critical assets" (@($staticPaths | Where-Object { $null -eq $staticResponses[$_] -or [int]$staticResponses[$_].StatusCode -ne 200 }).Count -eq 0) "$($staticPaths.Count) required files requested."

$manifestValid = $false
try {
  $manifest = (Get-TextContent -Response $staticResponses["/manifest.webmanifest"]) | ConvertFrom-Json
  $manifestValid = $manifest.lang -eq "es" -and @($manifest.icons).Count -eq 2
} catch { }
Add-Check "Manifest content" $manifestValid "Spanish manifest with two icons."

$scriptMatches = [Regex]::Matches($html, '<script[^>]+src="([^"]+\.js)"')
$styleMatches = [Regex]::Matches($html, '<link[^>]+href="([^"]+\.css)"')
$scriptUrls = @($scriptMatches | ForEach-Object { Resolve-PublicUrl $_.Groups[1].Value })
$styleUrls = @($styleMatches | ForEach-Object { Resolve-PublicUrl $_.Groups[1].Value })
Add-Check "Initial chunks declared" ($scriptUrls.Count -gt 0 -and $styleUrls.Count -gt 0) "$($scriptUrls.Count) script(s), $($styleUrls.Count) stylesheet(s)."

$pending = [Collections.Generic.Queue[string]]::new()
foreach ($scriptUrl in $scriptUrls) { $pending.Enqueue($scriptUrl) }
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$bundleContent = [Text.StringBuilder]::new()
$bundleResponses = @{}
while ($pending.Count -gt 0 -and $seen.Count -lt 40) {
  $scriptUrl = $pending.Dequeue()
  if (-not $seen.Add($scriptUrl)) { continue }
  try {
    $response = Get-Response $scriptUrl
    $bundleResponses[$scriptUrl] = $response
    $content = Get-TextContent -Response $response
    [void]$bundleContent.AppendLine($content)
    foreach ($match in [Regex]::Matches($content, '(?:\./|/assets/)[A-Za-z0-9_.-]+\.js')) {
      $discovered = [Uri]::new([Uri]$scriptUrl, $match.Value).AbsoluteUri
      if (-not $seen.Contains($discovered)) { $pending.Enqueue($discovered) }
    }
  } catch { $bundleResponses[$scriptUrl] = $null }
}
$failedBundles = @($bundleResponses.Keys | Where-Object { $null -eq $bundleResponses[$_] -or [int]$bundleResponses[$_].StatusCode -ne 200 })
Add-Check "JavaScript delivery" ($failedBundles.Count -eq 0 -and $seen.Count -ge $scriptUrls.Count) "$($seen.Count) discovered JavaScript chunk(s), $($failedBundles.Count) failed."

$failedStyles = 0
$styleContent = [Text.StringBuilder]::new()
$styleResponse = $null
foreach ($styleUrl in $styleUrls) {
  try {
    $styleResponse = Get-Response $styleUrl
    if ([int]$styleResponse.StatusCode -ne 200) { $failedStyles += 1 }
    [void]$styleContent.AppendLine((Get-TextContent -Response $styleResponse))
  } catch { $failedStyles += 1 }
}
Add-Check "CSS delivery" ($failedStyles -eq 0) "$($styleUrls.Count) stylesheet(s), $failedStyles failed."

$allText = "$html`n$($bundleContent.ToString())`n$($styleContent.ToString())"
Add-Check "No localhost in delivery" ($allText -notmatch "localhost|127\.0\.0\.1") "HTML, JS and CSS are free of localhost references."
$mapReferences = @($seen | Where-Object { (Get-StatusAllowFailure "$_`.map") -eq 200 })
Add-Check "No public sourcemaps" ($allText -notmatch "sourceMappingURL" -and $mapReferences.Count -eq 0) "No sourceMappingURL or reachable chunk .map."

$routeFailures = @()
foreach ($route in @("/", "/jugar", "/universo/001", "/ruta-inexistente-controlada")) {
  try {
    $routeResponse = Get-Response $route
    if ([int]$routeResponse.StatusCode -ne 200 -or -not (Get-TextContent -Response $routeResponse).Contains($ExpectedTitleTag)) { $routeFailures += $route }
  } catch { $routeFailures += $route }
}
Add-Check "SPA rewrite routing" ($routeFailures.Count -eq 0) "Root, jugar, universo/001 and unknown extensionless route serve index.html with 200."
$missingStaticStatus = Get-StatusAllowFailure "/assets/missing-control.css"
Add-Check "Missing static file control" ($missingStaticStatus -ne 200 -and $missingStaticStatus -ne 0) "Missing CSS returned HTTP $missingStaticStatus and was not rewritten."

$requiredHeaders = [ordered]@{
  "Strict-Transport-Security" = "max-age="
  "X-Content-Type-Options" = "nosniff"
  "X-Frame-Options" = "DENY"
  "Referrer-Policy" = "no-referrer"
  "Permissions-Policy" = "camera=()"
  "Content-Security-Policy" = "default-src 'self'"
}
$headerFailures = @()
foreach ($name in $requiredHeaders.Keys) {
  if ((Get-Header $root $name) -notlike "*$($requiredHeaders[$name])*" ) { $headerFailures += $name }
}
Add-Check "Security headers" ($headerFailures.Count -eq 0) $(if ($headerFailures.Count -eq 0) { "All six required policies are present." } else { "Missing/invalid: $($headerFailures -join ', ')" })
$csp = Get-Header $root "Content-Security-Policy"
$cspCompatible = $csp.Contains("script-src 'self'") -and $csp.Contains("style-src 'self' 'unsafe-inline'") -and $csp.Contains("img-src 'self' data: blob:") -and $csp.Contains("media-src 'self' data: blob:") -and $csp.Contains("connect-src 'self'") -and $csp -notmatch "unsafe-eval|https://"
Add-Check "Compatible same-origin CSP" $cspCompatible "React/Framer inline styles and local data/blob media are allowed without external origins or eval."

$rootCache = Get-Header $root "Cache-Control"
$mainScriptResponse = if ($scriptUrls.Count -gt 0) { $bundleResponses[$scriptUrls[0]] } else { $null }
$scriptCache = if ($null -ne $mainScriptResponse) { Get-Header $mainScriptResponse "Cache-Control" } else { "" }
$heroCache = Get-Header $staticResponses["/assets/colapso/backgrounds/hero_quantum_bg.webp"] "Cache-Control"
$manifestCache = Get-Header $staticResponses["/manifest.webmanifest"] "Cache-Control"
Add-Check "Index cache policy" ($rootCache -match "no-cache" -and $rootCache -match "no-store") $rootCache
Add-Check "Hashed asset cache policy" ($scriptCache -match "max-age=31536000" -and $scriptCache -match "immutable" -and $scriptCache -notmatch "no-store") $scriptCache
Add-Check "Identity asset cache policy" ($heroCache -match "max-age=86400" -and $manifestCache -match "max-age=3600") "Hero: $heroCache; manifest: $manifestCache"

$rootBytes = [Text.Encoding]::UTF8.GetByteCount($html)
$oversizedBundles = @($bundleResponses.Keys | Where-Object { $null -ne $bundleResponses[$_] -and [Text.Encoding]::UTF8.GetByteCount((Get-TextContent -Response $bundleResponses[$_])) -gt 700KB })
$oversizedCritical = @($staticPaths | Where-Object { $null -ne $staticResponses[$_] -and $staticResponses[$_].RawContentLength -gt 900KB })
Add-Check "Response size budgets" ($rootBytes -lt 100KB -and $oversizedBundles.Count -eq 0 -and $oversizedCritical.Count -eq 0) "HTML $rootBytes bytes; no JS >700 KiB or critical asset >900 KiB."

$productMarkers = @(
  "COMENZAR A JUGAR",
  "MISI$([char]0x00D3)N CU$([char]0x00C1)NTICA",
  "MODO EXPLORADOR",
  "RUTA GUIADA",
  "Procedencia cu$([char]0x00E1)ntica",
  "Llegaste a la salida"
)
$missingProductMarkers = @($productMarkers | Where-Object { -not $bundleContent.ToString().Contains($_) })
$audioChunkDelivered = @($seen | Where-Object { $_ -match "game-sound" }).Count -gt 0
Add-Check "Product HTTP smoke" ($missingProductMarkers.Count -eq 0 -and $audioChunkDelivered) $(if ($missingProductMarkers.Count -eq 0 -and $audioChunkDelivered) { "Hero actions, all modes, provenance, final screen and audio chunk are delivered." } else { "Missing markers: $($missingProductMarkers -join ', '); audio chunk: $audioChunkDelivered" })

Write-Host ("-" * 48)
Write-Host "AMPLIFY DEPLOYMENT VERIFICATION: $(if ($Failures -eq 0) { 'PASS' } else { 'FAIL' }) ($($Checks - $Failures)/$Checks checks)"
if ($Failures -gt 0) { exit 1 }
