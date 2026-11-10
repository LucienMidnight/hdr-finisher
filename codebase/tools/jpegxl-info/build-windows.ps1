param([Parameter(Mandatory=$true)][string]$WorkDir)
$ErrorActionPreference = 'Stop'
$WorkDir = [IO.Path]::GetFullPath($WorkDir)
New-Item -ItemType Directory -Force $WorkDir | Out-Null
$zip = Join-Path $WorkDir 'jxl-x64-windows.zip'
Invoke-WebRequest 'https://github.com/libjxl/libjxl/releases/download/v0.12.0/jxl-x64-windows.zip' -OutFile $zip
if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne '4EE3F72134A2A49774C357F2BFFECF30D752D702147896C493578789DE15A97C') { throw 'SDK hash mismatch' }
& 'C:/Program Files/7-Zip/7z.exe' x $zip "-o$WorkDir/sdk" -y
if ($LASTEXITCODE) { throw 'SDK extraction failed' }
$vs = & 'C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe' -products '*' -latest -property installationPath
$cmake = Join-Path $vs 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe'
$sdk = Join-Path $WorkDir 'sdk/x64-windows'
& $cmake -S $PSScriptRoot -B "$WorkDir/build" "-DJXL_INCLUDE_DIR=$sdk/include" "-DJXL_LIBRARY=$sdk/lib/jxl.lib"
if ($LASTEXITCODE) { throw 'Configure failed' }
& $cmake --build "$WorkDir/build" --config Release
if ($LASTEXITCODE) { throw 'Build failed' }
$bin = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../bin'))
Copy-Item "$WorkDir/build/Release/hdrf-jxl-info.exe" $bin
foreach ($name in @('jxl','jxl_cms','brotlicommon','brotlidec','brotlienc')) { Copy-Item "$sdk/bin/$name.dll" $bin }
foreach ($name in @('libjxl','brotli','highway','skcms')) { Copy-Item "$sdk/licenses/LICENSE.$name" "$bin/licenses/" }
