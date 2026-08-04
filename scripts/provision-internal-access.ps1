$ErrorActionPreference = "Stop"

$secureCode = $null
$bstr = [IntPtr]::Zero
$plainCode = $null
$process = $null

try {
    $secureCode = Read-Host "Novo codigo interno" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureCode)
    $plainCode = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

    $repositoryRoot = Split-Path -Parent $PSScriptRoot
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $tsxCli = Join-Path $repositoryRoot "node_modules\tsx\dist\cli.mjs"
    $provisioner = Join-Path $PSScriptRoot "provision-internal-access.ts"
    if (-not (Test-Path -LiteralPath $tsxCli -PathType Leaf)) {
        throw "tsx nao esta instalado em node_modules."
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodePath
    $startInfo.Arguments = '"' + $tsxCli + '" "' + $provisioner + '"'
    $startInfo.WorkingDirectory = $repositoryRoot
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Nao foi possivel iniciar o provisionador Node." }

    $process.StandardInput.WriteLine($plainCode)
    $process.StandardInput.Close()
    $plainCode = $null

    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($stdout) { [Console]::Out.Write($stdout) }
    if ($process.ExitCode -ne 0) {
        if ($stderr) { [Console]::Error.Write($stderr) }
        exit $process.ExitCode
    }
} finally {
    $plainCode = $null
    if ($bstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        $bstr = [IntPtr]::Zero
    }
    if ($secureCode -ne $null) { $secureCode.Dispose() }
    if ($process -ne $null) { $process.Dispose() }
    Remove-Variable plainCode, bstr, secureCode, process -ErrorAction SilentlyContinue
}
