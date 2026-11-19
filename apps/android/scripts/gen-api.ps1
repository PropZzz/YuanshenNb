$ErrorActionPreference = "Stop"

if ($env:JAVA_HOME) {
    $javaBin = Join-Path $env:JAVA_HOME "bin"
    if (Test-Path $javaBin) {
        $env:PATH = "$javaBin;$env:PATH"
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$androidDir = Resolve-Path (Join-Path $scriptDir "..")
$repoRoot = Resolve-Path (Join-Path $androidDir "..\..")
$openApiSpec = Join-Path $repoRoot "contracts\openapi.json"
$targetGenDir = Join-Path $androidDir "app\src\main\kotlin\app\shixu\core\network\generated"

$tempWorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("shixu-openapi-kotlin-" + [System.Guid]::NewGuid().ToString("N"))
$tempOutDir = Join-Path $tempWorkDir "out"
New-Item -ItemType Directory -Force -Path $tempWorkDir | Out-Null

$openApiToolsConfig = @'
{
  "$schema": "https://raw.githubusercontent.com/OpenAPITools/openapi-generator-cli/master/apps/generator-cli/src/config.schema.json",
  "spaces": 2,
  "generator-cli": {
    "version": "7.27.0"
  }
}
'@
[System.IO.File]::WriteAllText((Join-Path $tempWorkDir "openapitools.json"), $openApiToolsConfig, [System.Text.UTF8Encoding]::new($false))

try {
    Push-Location $tempWorkDir
    & npx --yes @openapitools/openapi-generator-cli@2.42.2 generate `
        -i $openApiSpec `
        -g kotlin `
        --library jvm-retrofit2 `
        --additional-properties=serializationLibrary=kotlinx_serialization,useCoroutines=true,packageName=app.shixu.core.network.generated `
        --type-mappings=AnyType=JsonElement,object=JsonElement `
        --import-mappings=JsonElement=kotlinx.serialization.json.JsonElement `
        -o $tempOutDir
    if ($LASTEXITCODE -ne 0) {
        throw "openapi-generator-cli failed with exit code $LASTEXITCODE"
    }

    $sourceGenDir = Join-Path $tempOutDir "src\main\kotlin\app\shixu\core\network\generated"
    if (Test-Path $targetGenDir) {
        Remove-Item -Recurse -Force $targetGenDir
    }
    New-Item -ItemType Directory -Force -Path $targetGenDir | Out-Null

    foreach ($pkg in @("apis", "models", "infrastructure", "auth")) {
        $srcPkg = Join-Path $sourceGenDir $pkg
        if (Test-Path $srcPkg) {
            Copy-Item -Recurse -Force $srcPkg (Join-Path $targetGenDir $pkg)
        }
    }

    # OpenAPI Generator 可能在 JsonElement 或顶层 @Serializable enum 属性前生成多余的 @Contextual，
    # 移除之以确保使用 kotlinx.serialization 原生/静态序列化器（保留 OffsetDateTime/LocalDate/UUID/URI 的 @Contextual）。
    $modelsDir = Join-Path $targetGenDir "models"
    if (Test-Path $modelsDir) {
        $enumNames = New-Object 'System.Collections.Generic.HashSet[string]'
        $modelFiles = Get-ChildItem -Path $modelsDir -Filter "*.kt"
        foreach ($file in $modelFiles) {
            $raw = Get-Content -Path $file.FullName -Raw -Encoding UTF8
            $matches = [System.Text.RegularExpressions.Regex]::Matches($raw, '(?m)^\s*enum\s+class\s+([A-Za-z0-9_]+)\b')
            foreach ($m in $matches) {
                [void]$enumNames.Add($m.Groups[1].Value)
            }
        }

        $enumRegex = $null
        if ($enumNames.Count -gt 0) {
            $escaped = ($enumNames | Sort-Object | ForEach-Object { [System.Text.RegularExpressions.Regex]::Escape($_) }) -join "|"
            $enumRegex = '@Contextual\s+(@SerialName\([^)]*\)\s*(?:\r?\n\s*)?(?:val|var)\s+[A-Za-z0-9_]+\s*:\s*(?:(?:' + $escaped + ')(?:\?|\b)|kotlin\.collections\.List<(?:' + $escaped + ')>))'
        }

        foreach ($file in $modelFiles) {
            $raw = Get-Content -Path $file.FullName -Raw -Encoding UTF8
            $updated = [System.Text.RegularExpressions.Regex]::Replace(
                $raw,
                '@Contextual\s+(@SerialName\([^)]*\)\s*(?:\r?\n\s*)?(?:val|var)\s+[^\r\n]*JsonElement)',
                '$1'
            )
            if ($enumRegex) {
                $updated = [System.Text.RegularExpressions.Regex]::Replace($updated, $enumRegex, '$1')
            }
            if ($updated -ne $raw) {
                [System.IO.File]::WriteAllText($file.FullName, $updated, [System.Text.UTF8Encoding]::new($false))
            }
        }
    }

    Write-Host "Generated Kotlin OpenAPI client files into $targetGenDir"
}
finally {
    Pop-Location -ErrorAction SilentlyContinue
    if (Test-Path $tempWorkDir) {
        Remove-Item -Recurse -Force $tempWorkDir -ErrorAction SilentlyContinue
    }
}
