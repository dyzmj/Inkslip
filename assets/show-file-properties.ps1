param([Parameter(Mandatory=$true)][string]$DocumentPath)
$ErrorActionPreference = 'Stop'
$resolvedDocument = (Resolve-Path -LiteralPath $DocumentPath).ProviderPath
$shellApplication = New-Object -ComObject Shell.Application
$folder = $shellApplication.Namespace([System.IO.Path]::GetDirectoryName($resolvedDocument))
$item = $folder.ParseName([System.IO.Path]::GetFileName($resolvedDocument))
if ($null -eq $item) { throw 'Windows Shell could not locate the document.' }
$item.InvokeVerb('properties')
