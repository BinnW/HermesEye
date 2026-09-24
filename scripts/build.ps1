param([string]$DevEcoHome = 'D:\dev-tools\DevEco Studio', [ValidateSet('debug','release')][string]$Mode = 'debug')
$ErrorActionPreference = 'Stop'
$env:DEVECO_SDK_HOME = Join-Path $DevEcoHome 'sdk'
$env:JAVA_HOME = Join-Path $DevEcoHome 'jbr'
$env:PATH = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH
$nodePath = Join-Path $DevEcoHome 'tools\node\node.exe'
$hvigorPath = Join-Path $DevEcoHome 'tools\hvigor\bin\hvigorw.js'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  & $nodePath $hvigorPath --mode module -p product=default -p module=entry@default -p "buildMode=$Mode" assembleHap --no-daemon
  if ($LASTEXITCODE -ne 0) { throw "Hvigor failed: $LASTEXITCODE" }
} finally { Pop-Location }
