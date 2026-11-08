# Генерация иконок KnowTomorrow из public/assets/logo.png.
# Запуск: pwsh -File scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$logoPath = Join-Path $root 'public/assets/logo.png'
$outDir = Join-Path $root 'public/assets/icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$source = [System.Drawing.Bitmap]::FromFile($logoPath)
$transparent = New-Object System.Drawing.Bitmap($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
for ($y = 0; $y -lt $source.Height; $y++) {
  for ($x = 0; $x -lt $source.Width; $x++) {
    $c = $source.GetPixel($x, $y)
    if ($c.R -gt 242 -and $c.G -gt 242 -and $c.B -gt 242) {
      $transparent.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, $c.R, $c.G, $c.B))
    } else {
      $transparent.SetPixel($x, $y, $c)
    }
  }
}

# Обрезаем прозрачные поля, иначе логотип выглядит крошечным в иконке.
$minX = $transparent.Width
$minY = $transparent.Height
$maxX = 0
$maxY = 0
for ($y = 0; $y -lt $transparent.Height; $y++) {
  for ($x = 0; $x -lt $transparent.Width; $x++) {
    if ($transparent.GetPixel($x, $y).A -gt 8) {
      if ($x -lt $minX) { $minX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
$cropWidth = $maxX - $minX + 1
$cropHeight = $maxY - $minY + 1
$cropped = New-Object System.Drawing.Bitmap($cropWidth, $cropHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$cropGraphics = [System.Drawing.Graphics]::FromImage($cropped)
$cropGraphics.DrawImage($transparent, (New-Object System.Drawing.Rectangle(0, 0, $cropWidth, $cropHeight)), (New-Object System.Drawing.Rectangle($minX, $minY, $cropWidth, $cropHeight)), [System.Drawing.GraphicsUnit]::Pixel)
$cropGraphics.Dispose()

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Icon([int]$size, [string]$background, [string]$output, [double]$scale, [bool]$maskable) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml($background))

  if ($maskable) {
    $inset = $size * 0.1
    $rect = New-RoundedPath $inset $inset ($size - 2 * $inset) ($size - 2 * $inset) ($size * 0.16)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#f6f4ef'))
    $graphics.FillPath($brush, $rect)
    $brush.Dispose()
    $rect.Dispose()
  }

  $logoWidth = [int]($size * $scale)
  $logoHeight = [int]($logoWidth * $cropped.Height / $cropped.Width)
  $x = [int](($size - $logoWidth) / 2)
  $y = [int](($size - $logoHeight) / 2)
  $graphics.DrawImage($cropped, $x, $y, $logoWidth, $logoHeight)
  $bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

New-Icon 512 '#f6f4ef' (Join-Path $outDir 'icon-512.png') 0.78 $false
New-Icon 256 '#f6f4ef' (Join-Path $outDir 'icon-256.png') 0.78 $false
New-Icon 192 '#f6f4ef' (Join-Path $outDir 'icon-192.png') 0.78 $false
New-Icon 512 '#0c2338' (Join-Path $outDir 'icon-maskable-512.png') 0.46 $true
New-Icon 192 '#0c2338' (Join-Path $outDir 'icon-maskable-192.png') 0.46 $true
New-Icon 180 '#f6f4ef' (Join-Path $outDir 'apple-touch-icon.png') 0.78 $false
New-Icon 64 '#f6f4ef' (Join-Path $outDir 'favicon.png') 0.84 $false
New-Icon 32 '#f6f4ef' (Join-Path $outDir 'favicon-32.png') 0.86 $false

$cropped.Dispose()
$transparent.Dispose()
$source.Dispose()
Write-Host "Иконки созданы в $outDir"
