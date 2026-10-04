# One-off generator for public/og.png — the raster link-preview card.
#
# Facebook, Zalo, Telegram, Slack, LinkedIn and most AI answer engines do not
# render SVG in og:image, so a card that looks perfect in a browser can show as a
# blank box everywhere it actually matters. The SVG renderer in src/pages.js stays
# for the pages that do handle it; this writes the one PNG every platform can
# display.
#
# The output is committed, so the build and the server need no image library at
# all. Regenerate only when the brand palette or the mark changes:
#
#     pwsh -ExecutionPolicy Bypass -File scripts/make-og-image.ps1
#
# The colours and the mark are the ones in public/styles.css, so the card and the
# storefront read as the same product.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'public\og.png'

$W = 1200
$H = 630
$fmt = [System.Drawing.StringFormat]::GenericTypographic
$measureBox = [System.Drawing.SizeF]::new(2000, 400)

# Colours lifted from public/styles.css so the card is not a different product.
$WHITE = [System.Drawing.Color]::FromArgb(255, 255, 255)
$MINT = [System.Drawing.Color]::FromArgb(143, 211, 178)
$MUTED = [System.Drawing.Color]::FromArgb(150, 196, 176)
$CORAL = [System.Drawing.Color]::FromArgb(255, 118, 91)

$bmp = [System.Drawing.Bitmap]::new($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

function New-RoundedPath([System.Drawing.RectangleF]$r, [double]$radius) {
  $p = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = [double]$radius
  $p.AddArc($r.X, $r.Y, $d, $d, 180, 90)
  $p.AddArc(($r.Right - $d), $r.Y, $d, $d, 270, 90)
  $p.AddArc(($r.Right - $d), ($r.Bottom - $d), $d, $d, 0, 90)
  $p.AddArc($r.X, ($r.Bottom - $d), $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Measure-Width($graphics, [string]$text, $font) {
  return [double]$graphics.MeasureString($text, $font, [System.Drawing.SizeF]::new(2000, 400), $fmt).Width
}

# Background: the same diagonal green the SVG card uses.
$brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.RectangleF]::new(0, 0, $W, $H),
  [System.Drawing.Color]::FromArgb(15, 42, 34),
  [System.Drawing.Color]::FromArgb(22, 58, 47),
  [single]45.0)
$g.FillRectangle($brush, 0, 0, $W, $H)
$brush.Dispose()

# A soft light in the top right, faded rather than a flat circle so it reads as
# glow and not as a shape.
$brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.RectangleF]::new(760, -130, 620, 620),
  [System.Drawing.Color]::FromArgb(90, 34, 84, 68),
  [System.Drawing.Color]::FromArgb(0, 34, 84, 68),
  [single]45.0)
$g.FillEllipse($brush, 760, -130, 620, 620)
$brush.Dispose()

# The brand mark: the shop's actual logo, drawn from public/img/sonvudev.logo.png.
#
# This used to be a rounded square with the letter "S" painted into it, drawn here in
# code. That made the share card the one surface carrying a hand-drawn second version
# of the logo — the tab, the iOS icon and the home screen all showed the real mark,
# and the card that Facebook, Zalo and LinkedIn render showed a different one. The
# mark is a file now, and this reads it.
#
# logo-mint rather than the source mark. The card background is the brand dark, and the
# source mark is a flat #3f6a5c — 2.31:1 against it, below the 3:1 WCAG asks of a
# graphic that carries meaning, which is why the mark looked like it was not there at
# all. logo-mint is the same silhouette in --mint, 4.7:1 on this background.
$logoPath = Join-Path $root 'public\logo-mint-512.png'
if (-not (Test-Path -LiteralPath $logoPath)) {
  throw "Khong tim thay logo nguon: $logoPath"
}
$logo = [System.Drawing.Image]::FromFile($logoPath)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($logo, 90, 74, 74, 74)
$logo.Dispose()

# The brand name, from the same BRAND_NAME the site reads. It was the literal
# 'SonVu' and 'Dev' typed here and coloured to match the header, so renaming the shop
# updated the storefront and left the share card — the one image anybody outside the
# shop ever sees — announcing the old name.
$brandName = 'SonVuDev'
$envFile = Join-Path $root '.env'
if (Test-Path -LiteralPath $envFile) {
  $match = Select-String -LiteralPath $envFile -Pattern '^BRAND_NAME=(.*)$' | Select-Object -First 1
  if ($match) { $brandName = $match.Matches[0].Groups[1].Value.Trim() }
}
if (-not $brandName) { $brandName = 'SonVuDev' }

# Split on the last capital that starts a word — the same rule src/pages.js uses for
# the header wordmark — so the two halves colour identically.
$head = $brandName
$tail = ''
for ($i = $brandName.Length - 1; $i -gt 0; $i--) {
  if ($brandName[$i] -cmatch '[A-Z]' -and $brandName[$i - 1] -cmatch '[a-z0-9]') {
    $head = $brandName.Substring(0, $i)
    $tail = $brandName.Substring($i)
    break
  }
}

$font = [System.Drawing.Font]::new('Arial', 42, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$width = Measure-Width $g $head $font
$brush = [System.Drawing.SolidBrush]::new($WHITE)
$g.DrawString($head, $font, $brush, [System.Drawing.PointF]::new(180, 86), $fmt)
$brush.Dispose()
if ($tail) {
  $brush = [System.Drawing.SolidBrush]::new($CORAL)
  $g.DrawString($tail, $font, $brush, [System.Drawing.PointF]::new((180 + $width), 86), $fmt)
  $brush.Dispose()
}
$font.Dispose()

$font = [System.Drawing.Font]::new('Arial', 18, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$brush = [System.Drawing.SolidBrush]::new($MINT)
$g.DrawString('PHAN MEM WINDOWS CHO CONG VIEC', $font, $brush, [System.Drawing.PointF]::new(92, 208), $fmt)
$brush.Dispose()
$font.Dispose()

$font = [System.Drawing.Font]::new('Arial', 64, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$brush = [System.Drawing.SolidBrush]::new($WHITE)
$g.DrawString('Phần mềm tốt cho', $font, $brush, [System.Drawing.PointF]::new(90, 254), $fmt)
$brush.Dispose()
$brush = [System.Drawing.SolidBrush]::new($CORAL)
$g.DrawString('công việc tốt.', $font, $brush, [System.Drawing.PointF]::new(90, 330), $fmt)
$brush.Dispose()
$font.Dispose()

$font = [System.Drawing.Font]::new('Segoe UI', 26, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$brush = [System.Drawing.SolidBrush]::new($MUTED)
$g.DrawString('Tiện ích Windows tự viết: dễ cài đặt, minh bạch, cập nhật dài hạn.', $font, $brush, [System.Drawing.PointF]::new(90, 434), $fmt)
$brush.Dispose()
$font.Dispose()

# The three things a buyer actually decides on, stated rather than decorated.
$font = [System.Drawing.Font]::new('Segoe UI', 21, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(46, 255, 255, 255))
$edge = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(72, 255, 255, 255), 2)
$text = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(228, 244, 252))
$x = [double]90
foreach ($label in @('Mua một lần', 'Tải ngay sau khi thanh toán', 'Hoàn tiền nếu file lỗi')) {
  $w1 = Measure-Width $g $label $font
  $pill = [System.Drawing.RectangleF]::new($x, 512, ($w1 + 44), 46)
  $path = New-RoundedPath $pill 23
  $g.FillPath($fill, $path)
  $g.DrawPath($edge, $path)
  $path.Dispose()
  $g.DrawString($label, $font, $text, [System.Drawing.PointF]::new(($x + 22), 522), $fmt)
  $x += $pill.Width + 14
}

$g.Dispose()

# PNG only, no metadata: every byte here travels to every share.
$bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "Wrote $target"
