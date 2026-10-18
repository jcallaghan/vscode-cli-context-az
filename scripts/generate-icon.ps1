using namespace System.Drawing
using namespace System.Drawing.Drawing2D
using namespace System.Drawing.Imaging
using namespace System.Drawing.Text

param(
	[ValidateSet('AZ', 'GH')]
	[string] $Tag = 'AZ',

	[Parameter(Mandatory)]
	[string] $OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $IsWindows) {
	throw 'Icon generation uses System.Drawing on Windows. Other platforms use the committed PNG.'
}

Add-Type -AssemblyName System.Drawing
$destination = [System.IO.Path]::GetFullPath($OutputPath)
if (-not (Test-Path -LiteralPath ([System.IO.Path]::GetDirectoryName($destination)) -PathType Container)) {
	throw "The output directory does not exist: $destination"
}

$resources = [System.Collections.Generic.List[System.IDisposable]]::new()
try {
	$canvas = [Bitmap]::new(1024, 1024)
	$resources.Add($canvas)
	$graphics = [Graphics]::FromImage($canvas)
	$resources.Add($graphics)
	$graphics.SmoothingMode = [SmoothingMode]::AntiAlias
	$graphics.TextRenderingHint = [TextRenderingHint]::AntiAliasGridFit
	$graphics.ScaleTransform(4, 4)
	$graphics.Clear([Color]::FromArgb(13, 33, 55))

	$ink = [SolidBrush]::new([Color]::FromArgb(232, 245, 255))
	$resources.Add($ink)
	$accent = [SolidBrush]::new([Color]::FromArgb(38, 154, 237))
	$resources.Add($accent)
	$frame = [Pen]::new($ink, 7)
	$resources.Add($frame)
	$prompt = [Pen]::new($ink, 9)
	$prompt.StartCap = [LineCap]::Round
	$prompt.EndCap = [LineCap]::Round
	$prompt.LineJoin = [LineJoin]::Round
	$resources.Add($prompt)
	$shape = [GraphicsPath]::new()
	$resources.Add($shape)
	$shape.AddArc(24, 28, 24, 24, 180, 90)
	$shape.AddArc(208, 28, 24, 24, 270, 90)
	$shape.AddArc(208, 192, 24, 24, 0, 90)
	$shape.AddArc(24, 192, 24, 24, 90, 90)
	$shape.CloseFigure()
	$graphics.DrawPath($frame, $shape)
	$graphics.DrawLine($frame, 24, 72, 232, 72)

	$headerFont = [Font]::new('Segoe UI', 23, [FontStyle]::Bold, [GraphicsUnit]::Pixel)
	$resources.Add($headerFont)
	$tagFont = [Font]::new('Segoe UI', 44, [FontStyle]::Bold, [GraphicsUnit]::Pixel)
	$resources.Add($tagFont)
	$center = [StringFormat]::new()
	$center.Alignment = [StringAlignment]::Center
	$center.LineAlignment = [StringAlignment]::Center
	$resources.Add($center)
	$graphics.DrawString('CLI', $headerFont, $ink, [RectangleF]::new(40, 30, 62, 38), $center)
	foreach ($x in @(170, 188, 206)) {
		$graphics.FillEllipse($ink, $x, 46, 7, 7)
	}
	$graphics.DrawLines($prompt, [PointF[]]@(
		[PointF]::new(52, 104), [PointF]::new(76, 126), [PointF]::new(52, 148)
	))
	$graphics.DrawLine($prompt, 94, 148, 122, 148)
	$graphics.FillRectangle($accent, 132, 158, 100, 74)
	$graphics.DrawString($Tag, $tagFont, [Brushes]::White, [RectangleF]::new(132, 158, 100, 74), $center)

	$icon = [Bitmap]::new(256, 256)
	$resources.Add($icon)
	$scaled = [Graphics]::FromImage($icon)
	$resources.Add($scaled)
	$scaled.InterpolationMode = [InterpolationMode]::HighQualityBicubic
	$scaled.DrawImage($canvas, 0, 0, 256, 256)
	$icon.Save($destination, [ImageFormat]::Png)
	Write-Output "Generated CLI Context $Tag icon: $destination"
} finally {
	for ($index = $resources.Count - 1; $index -ge 0; $index--) {
		$resources[$index].Dispose()
	}
}
