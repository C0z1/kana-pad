# Genera el keystore estable de Android para Kana Pad, FUERA del repositorio.
# Con él, cada versión nueva del APK se instala encima de la anterior sin desinstalar ni perder progreso.
#
# Uso (PowerShell):  ./tools/android-keystore.ps1
# Después: guarda el archivo y la contraseña en un gestor de contraseñas. Si se pierden, las
# instalaciones existentes no podrán actualizarse (habrá que desinstalar, exportando antes).
# Para que GitHub firme los APK, carga los tres secretos (solo cuando lo decidas):
#   gh secret set ANDROID_KEYSTORE_B64 < "$env:USERPROFILE\.kanapad\kanapad-release.jks.b64"
#   gh secret set ANDROID_KEY_ALIAS --body kanapad
#   gh secret set ANDROID_KEY_PASSWORD      (te pide la contraseña)

$ErrorActionPreference = "Stop"
$dir = Join-Path $env:USERPROFILE ".kanapad"
$jks = Join-Path $dir "kanapad-release.jks"
if (Test-Path $jks) { throw "Ya existe $jks. No lo sobrescribo: perderías la clave con la que firmaste antes." }

$keytool = @(
  (Get-Command keytool -ErrorAction SilentlyContinue)?.Source,
  "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $keytool) { throw "No encontré keytool. Instala Java o Android Studio." }

New-Item -ItemType Directory -Force $dir | Out-Null
$pass = Read-Host "Contraseña nueva para el keystore (mínimo 6 caracteres)" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pass))
& $keytool -genkeypair -v -keystore $jks -alias kanapad -keyalg RSA -keysize 4096 -validity 10000 `
  -storepass $plain -keypass $plain -dname "CN=Kana Pad, O=C0z1, C=MX"
[Convert]::ToBase64String([IO.File]::ReadAllBytes($jks)) | Set-Content -Encoding ascii "$jks.b64"
Write-Host "Listo: $jks (y $jks.b64 para el secreto de GitHub). Guárdalos junto con la contraseña."
