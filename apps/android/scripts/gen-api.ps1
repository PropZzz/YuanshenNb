$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$androidDir = Resolve-Path (Join-Path $scriptDir "..")
$repoRoot = Resolve-Path (Join-Path $androidDir "..\..")
$openApiSpec = Join-Path $repoRoot "contracts\openapi.json"
$targetGenDir = Join-Path $androidDir "app\src\main\kotlin\app\shixu\core\network\generated"

$tempWorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("shixu-openapi-kotlin-" + [System.Guid]::NewGuid().ToString("N"))
$tempOutDir = Join-Path $tempWorkDir "out"
New-Item -ItemType Directory -Force -Path $tempWorkDir | Out-Null

try {
    Push-Location $tempWorkDir
    & npx --yes @openapitools/openapi-generator-cli generate `
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

    # OpenAPI Generator 可能在 JsonElement / Map<..., JsonElement> 属性前保留 @Contextual，移除之以使用 kotlinx.serialization 原生序列化器
    $modelsDir = Join-Path $targetGenDir "models"
    if (Test-Path $modelsDir) {
        Get-ChildItem -Path $modelsDir -Filter "*.kt" | ForEach-Object {
            $raw = Get-Content -Path $_.FullName -Raw -Encoding UTF8
            $updated = [System.Text.RegularExpressions.Regex]::Replace(
                $raw,
                '@Contextual\s+(@SerialName\([^)]*\)\s*(?:\r?\n\s*)?(?:val|var)\s+[^\r\n]*JsonElement)',
                '$1'
            )
            if ($updated -ne $raw) {
                [System.IO.File]::WriteAllText($_.FullName, $updated, [System.Text.UTF8Encoding]::new($false))
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
