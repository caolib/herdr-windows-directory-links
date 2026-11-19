# Windows PowerShell 5.1 is used only to compile once, not for every click.
# Source/output paths arrive as stdin JSON, never interpolated command text.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($request.operation -ne 'build') { throw 'invalid_operation' }
    if ([System.IO.File]::Exists([string]$request.output)) { throw 'output_exists' }
    Add-Type -LiteralPath ([string[]]$request.sources) -OutputAssembly ([string]$request.output) `
        -OutputType ConsoleApplication -ReferencedAssemblies @('System.dll', 'System.Core.dll', 'System.Web.Extensions.dll')
    [Console]::WriteLine('{"built":true}')
} catch {
    [Console]::Error.WriteLine('build_failed')
    exit 1
}
