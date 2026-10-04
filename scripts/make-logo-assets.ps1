# Generates every icon and logo asset the site needs from one source file.
#
#   pwsh -ExecutionPolicy Bypass -File scripts/make-logo-assets.ps1
#
# Why this exists: the mark lived in exactly one place, public/favicon.svg, and that
# one file was doing five jobs — browser tab, schema.org Organization.logo, and the
# three that nobody had built yet. A 64x64 SVG is a poor answer to Google, which asks
# for at least 112x112, and it is no answer at all to an iPhone home screen, a
# Windows taskbar, an installed PWA or a browser that will not render SVG favicons.
#
# So there is one source — public/img/sonvudev.logo.png — and everything else is
# derived from it here. Replace the source, run this, and every slot a logo can
# occupy is updated together. Nothing is hand-drawn a second time.
#
# The output is committed on purpose: the build and the server then need no image
# library at all, exactly as scripts/make-og-image.ps1 already works, and a deploy is
# a file copy rather than a step that can fail on a machine without an image library.
#
# test/logo.test.js asserts every file this writes is present and is referenced by a
# page, so a slot added here without a <link> for it fails the build rather than
# shipping a file nothing loads.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'public\img\sonvudev.logo.png'

if (-not (Test-Path -LiteralPath $source)) {
  throw "Khong tim thay nguon logo: $source"
}

# Lifted from public/styles.css and src/pages.js so the icons, the card and the
# storefront are one brand rather than three shades of green.
$BRAND_DARK = [System.Drawing.Color]::FromArgb(255, 15, 42, 34)   # #0f2a22
$MINT = [System.Drawing.Color]::FromArgb(255, 111, 176, 139)       # #6fb08b

function New-Canvas([int]$size, [System.Drawing.Color]$background) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear($background)
  return @($bitmap, $graphics)
}

function Save-Png($bitmap, [string]$relative) {
  $target = Join-Path $root $relative
  $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host ("  {0,-32} {1}x{2}" -f $relative, $bitmap.Width, $bitmap.Height)
}

$logo = [System.Drawing.Image]::FromFile($source)
Write-Host "Nguon: public\img\sonvudev.logo.png ($($logo.Width)x$($logo.Height))"

# ---------------------------------------------------------------- transparent set
# Kept transparent so the mark sits on whatever background the platform gives it.
# 180 is deliberately absent: apple-touch-icon is that size, and a second 180px file
# that no <link> points at is a file nothing loads.
foreach ($size in @(16, 32, 48, 64, 192, 512)) {
  $canvas = New-Canvas $size ([System.Drawing.Color]::Transparent)
  $graphics = $canvas[1]
  $graphics.DrawImage($logo, 0, 0, $size, $size)
  $graphics.Dispose()
  Save-Png $canvas[0] "public\icon-$size.png"
  $canvas[0].Dispose()
}

# A copy at the source size, because schema.org and Google want the largest honest
# logo the shop can publish rather than a downscaled one.
$canvas = New-Canvas 1024 ([System.Drawing.Color]::Transparent)
$canvas[1].DrawImage($logo, 0, 0, 1024, 1024)
$canvas[1].Dispose()
Save-Png $canvas[0] 'public\logo-1024.png'
$canvas[0].Dispose()

# ------------------------------------------------------------ apple-touch-icon
# iOS composites a home-screen icon onto an opaque tile and ignores the alpha
# channel, so a transparent icon renders as a black square with a mark floating in
# it. The brand background is painted in first for exactly that reason.
$canvas = New-Canvas 180 $BRAND_DARK
$graphics = $canvas[1]
# 82% of the tile, the ratio Apple's own template uses, so the mark is not cropped
# by the rounded-corner mask.
$pad = [int](180 * 0.09)
$graphics.DrawImage($logo, $pad, $pad, 180 - 2 * $pad, 180 - 2 * $pad)
$graphics.Dispose()
Save-Png $canvas[0] 'public\apple-touch-icon.png'
$canvas[0].Dispose()

# -------------------------------------------------------------------- favicon.ico
# The multi-size ICO Windows still asks for. Entries are PNG-encoded, which every
# Windows version since Vista reads, and the format allows it — the directory entry
# stores the dimensions in a single byte rather than two.
$sizes = @(16, 32, 48)
$images = @()
foreach ($size in $sizes) {
  $canvas = New-Canvas $size ([System.Drawing.Color]::Transparent)
  $canvas[1].DrawImage($logo, 0, 0, $size, $size)
  $canvas[1].Dispose()
  $stream = New-Object System.IO.MemoryStream
  $canvas[0].Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $images += ,@{ Bytes = $stream.ToArray(); Size = $size }
  $canvas[0].Dispose()
  $stream.Dispose()
}

$ico = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($ico)
$writer.Write([UInt16]0)          # reserved
$writer.Write([UInt16]1)          # type: icon
$writer.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
foreach ($entry in $images) {
  $size = $entry.Size
  $writer.Write([Byte]$(if ($size -ge 256) { 0 } else { $size }))
  $writer.Write([Byte]$(if ($size -ge 256) { 0 } else { $size }))
  $writer.Write([Byte]0)          # palette size
  $writer.Write([Byte]0)          # reserved
  $writer.Write([UInt16]1)         # colour planes
  $writer.Write([UInt16]32)        # bits per pixel
  $writer.Write([UInt32]$entry.Bytes.Length)
  $writer.Write([UInt32]$offset)
  $offset += $entry.Bytes.Length
}
foreach ($entry in $images) { $writer.Write($entry.Bytes) }
$writer.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $root 'public\favicon.ico'), $ico.ToArray())
$writer.Dispose()
$ico.Dispose()
Write-Host ("  {0,-32} {1} sizes" -f 'public\favicon.ico', $sizes.Count)

# ------------------------------------------------------------------ favicon.svg
# Kept as an SVG because it is the sharpest icon a browser tab can show, but built
# by embedding a 64x64 render of the same source rather than by tracing the mark a
# second time by hand. Two hand-drawn copies of one logo is how the tab icon and the
# home screen icon end up being different logos.
$canvas = New-Canvas 64 ([System.Drawing.Color]::Transparent)
$canvas[1].DrawImage($logo, 0, 0, 64, 64)
$canvas[1].Dispose()
$stream = New-Object System.IO.MemoryStream
$canvas[0].Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$canvas[0].Dispose()
$base64 = [Convert]::ToBase64String($stream.ToArray())
$stream.Dispose()
$svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Logo"><image width="64" height="64" href="data:image/png;base64,$base64"/></svg>
"@
[System.IO.File]::WriteAllText((Join-Path $root 'public\favicon.svg'), $svg)
Write-Host ("  {0,-32} {1} bytes embedded" -f 'public\favicon.svg', $base64.Length)

# ------------------------------------------------------------- monochrome mask
# Safari pinned tabs take a single-colour silhouette and recolour it to the user's
# toolbar, so a full-colour mark is invisible there. Generated by keeping every pixel
# that is visibly part of the mark and painting it one colour: the alpha channel
# already is the mark's silhouette.
$mono = New-Object System.Drawing.Bitmap(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$mgraphics = [System.Drawing.Graphics]::FromImage($mono)
$mgraphics.Clear([System.Drawing.Color]::Transparent)
$mgraphics.DrawImage($logo, 0, 0, 512, 512)
$mgraphics.Dispose()
$tint = New-Object System.Drawing.Bitmap(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$tintGraphics = [System.Drawing.Graphics]::FromImage($tint)
$tintGraphics.Clear($BRAND_DARK)
$tintGraphics.DrawImage($mono, 0, 0)
$tintGraphics.Dispose()
$mono.Dispose()

$stream = New-Object System.IO.MemoryStream
$tint.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$mono64 = New-Object System.Drawing.Bitmap(64, 64, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$m64 = [System.Drawing.Graphics]::FromImage($mono64)
$m64.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$m64.DrawImage($tint, 0, 0, 64, 64)
$m64.Dispose()
$mono64.Save((Join-Path $root 'public\mask-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$mono64.Dispose()
$tint.Dispose()
Write-Host ("  {0,-32} {1}x{2}" -f 'public\mask-icon.png', 64, 64)

$logo.Dispose()
Write-Host ''
Write-Host 'Xong. Commit cung cac file trong public/ cung voi nguon logo.'
