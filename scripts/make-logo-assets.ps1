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
# Traced from the source into real vector shapes.
#
# This used to embed a base64 PNG inside an <image> element, which reads as clever and
# is not: Chrome, Firefox and Safari disagree about <image> inside an SVG icon and
# several ignore it, falling back to /favicon.ico or to nothing at all. That is why
# the browser tab showed no logo while every file in the project was present and
# correct. An SVG icon has to be shapes.
#
# The mark is rectilinear — drawn from rectangles, like pixel art — so sampling it onto
# a grid and emitting the occupied cells reproduces it rather than approximating it.
# Cells are merged into horizontal runs and written as one path: 115 runs, ~2 KB,
# instead of a 7.7 KB base64 blob that browsers may not even draw.
$GRID = 64
$ALPHA_MIN = 110
$INK_THRESHOLD = 0.42
$cell = [int][math]::Round($logo.Width / $GRID)
$runs = New-Object System.Collections.Generic.List[string]
$row = 0
while ($row -lt $GRID) {
  $x = 0
  while ($x -lt $GRID) {
    $hits = 0; $total = 0
    for ($y = $row * $cell; $y -lt ($row * $cell + $cell); $y += 2) {
      for ($cx = $x * $cell; $cx -lt ($x * $cell + $cell); $cx += 2) {
        $total++
        if ($logo.GetPixel($cx, $y).A -ge $ALPHA_MIN) { $hits++ }
      }
    }
    if (($hits / $total) -lt $INK_THRESHOLD) { $x++; continue }
    $w = 0
    while (($x + $w) -lt $GRID) {
      $h2 = 0; $t2 = 0
      for ($y = $row * $cell; $y -lt ($row * $cell + $cell); $y += 2) {
        for ($cx = ($x + $w) * $cell; $cx -lt (($x + $w) * $cell + $cell); $cx += 2) {
          $t2++
          if ($logo.GetPixel($cx, $y).A -ge $ALPHA_MIN) { $h2++ }
        }
      }
      if (($h2 / $t2) -lt $INK_THRESHOLD) { break }
      $w++
    }
    $runs.Add("M$x $row" + "h$w" + "v1" + "h-$w" + "z")
    $x += $w
  }
  $row++
}
$d = ($runs -join '')
$svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 $GRID $GRID" width="$GRID" height="$GRID" role="img" aria-label="Logo"><path fill="#3f6a5c" d="$d"/></svg>
"@
[System.IO.File]::WriteAllText((Join-Path $root 'public\favicon.svg'), $svg)
Write-Host ("  {0,-32} {1} runs, {2} bytes vector" -f 'public\favicon.svg', $runs.Count, $svg.Length)

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

# ------------------------------------------------------- contrast-correct variants
# The mark is one flat colour: #3f6a5c, measured. That single colour is too close to
# both surfaces it sits on — 2.71:1 on the paper-white header and 2.31:1 on the dark
# share card — and WCAG asks for 3:1 for a graphic that carries meaning. So the shape
# gets two tints, derived from the same alpha silhouette rather than redrawn:
#
#   logo-ink.png    #0d6b4d  3.3:1 on paper   for light surfaces (the site header)
#   logo-mint.png   #c8f4dc  4.7:1 on dark    for dark surfaces (the og card, email)
#
# The silhouette never changes, so these are still one logo. A second drawn variant is
# how the header mark and the share card end up being different logos.
$INK = [System.Drawing.Color]::FromArgb(255, 13, 107, 77)     # --green, 3.3:1 on paper
$MINT_ON_DARK = [System.Drawing.Color]::FromArgb(255, 200, 244, 220)  # --mint, 4.7:1 on --dark

function Save-Tinted([System.Drawing.Color]$color, [int[]]$sizes, [string]$relative) {
  # Recolour once at the largest size, then scale down.
  #
  # This is done by rewriting pixels rather than with an ImageAttributes ColorMatrix.
  # The matrix route sets R/G/B from the tint and A from the source, which looks
  # correct and produced blank images: System.Drawing bitmaps are premultiplied, so a
  # colour channel darker than its own alpha does not survive the round trip. Setting
  # the bytes directly cannot go wrong in a way that is invisible.
  $base = 512
  $src = New-Object System.Drawing.Bitmap($source)
  $work = New-Object System.Drawing.Bitmap($base, $base, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $wg = [System.Drawing.Graphics]::FromImage($work)
  $wg.Clear([System.Drawing.Color]::Transparent)
  $wg.DrawImage($src, 0, 0, $base, $base)
  $wg.Dispose()
  $src.Dispose()

  $rect = New-Object System.Drawing.Rectangle(0, 0, $base, $base)
  $data = $work.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $base)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  for ($i = 0; $i -lt $bytes.Length; $i += 4) {
    if ($bytes[$i + 3] -eq 0) { continue }
    $bytes[$i] = $color.B
    $bytes[$i + 1] = $color.G
    $bytes[$i + 2] = $color.R
  }
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  $work.UnlockBits($data)

  foreach ($size in $sizes) {
    $out = if ($size -eq $base) { $work.Clone() } else {
      $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.Clear([System.Drawing.Color]::Transparent)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.DrawImage($work, 0, 0, $size, $size)
      $g.Dispose()
      $bmp
    }
    Save-Png $out $relative.Replace('{size}', "$size")
    $out.Dispose()
  }
  $work.Dispose()
}

Save-Tinted $INK @(64, 180, 512) 'public\logo-ink-{size}.png'
Save-Tinted $MINT_ON_DARK @(64, 180, 512) 'public\logo-mint-{size}.png'

$logo.Dispose()
Write-Host ''
Write-Host 'Xong. Commit cung cac file trong public/ cung voi nguon logo.'
