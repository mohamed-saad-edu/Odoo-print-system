#Requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$source = Join-Path (Split-Path -Parent $PSScriptRoot) "scripts/verify-windows-release.ps1"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -ne 0) { throw "Release verifier has parse errors: $parseErrors" }
foreach ($name in @("Assert-ExactFileHash", "Assert-ReleaseSignatureRecord")) {
  $definitions = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true))
  if ($definitions.Count -ne 1) { throw "Missing production helper '$name'" }
  Invoke-Expression $definitions[0].Extent.Text
}
$checks = 0
function Assert-Throws([scriptblock]$Action) {
  $failed = $false
  try { & $Action | Out-Null } catch { $failed = $true }
  if (-not $failed) { throw "Expected release evidence to be rejected" }
  $script:checks++
}
$fixture = Join-Path ([IO.Path]::GetTempPath()) ("yaseir-artifact-" + [guid]::NewGuid().ToString("N"))
try {
  [IO.File]::WriteAllText($fixture, "candidate bytes")
  $expected = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash
  Assert-ExactFileHash $fixture $expected
  $checks++
  [IO.File]::WriteAllText($fixture, "different installed bytes")
  Assert-Throws { Assert-ExactFileHash $fixture $expected }
  Assert-Throws { Assert-ExactFileHash $fixture "" }
  Assert-Throws { Assert-ExactFileHash ($fixture + ".missing") $expected }
} finally { Remove-Item -LiteralPath $fixture -Force -ErrorAction SilentlyContinue }
$record = [pscustomobject]@{ Status = "Valid"; Thumbprint = "AABBCC"; Subject = "CN=Publisher"; Issuer = "CN=Issuer"; CodeSigningEku = $true; ChainValid = $true }
Assert-ReleaseSignatureRecord $record "aabbcc"
$checks++
Assert-Throws { Assert-ReleaseSignatureRecord $record "WRONG" }
foreach ($field in @("CodeSigningEku", "ChainValid")) {
  $bad = $record.PSObject.Copy(); $bad.$field = $false
  Assert-Throws { Assert-ReleaseSignatureRecord $bad "AABBCC" }
}
foreach ($status in @("NotSigned", "NotTrusted", "HashMismatch", "UnknownError")) {
  $bad = $record.PSObject.Copy(); $bad.Status = $status
  Assert-Throws { Assert-ReleaseSignatureRecord $bad "AABBCC" }
}
$bad = $record.PSObject.Copy(); $bad.Issuer = $bad.Subject
Assert-Throws { Assert-ReleaseSignatureRecord $bad "AABBCC" }
Write-Host "Release artifact verification helper checks passed: $checks"
