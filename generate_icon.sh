#!/bin/bash
# Generate app icons with bottom-left alignment
# This script uses ImageMagick to composite the wolf logo at bottom-left position

set -e

SVG_FILE="Logo_SVGs_new/Howlingual_icon_ダーク_wolfonly.svg"
OUTPUT_DIR="src-tauri/icons"
BG_COLOR="#2d2d2d"

mkdir -p "$OUTPUT_DIR"

# Function to generate icon with bottom-left alignment
generate_icon() {
    local size=$1
    local output_file=$2
    
    echo "Generating $output_file (${size}x${size})..."
    
    # First, convert SVG to PNG at full size
    rsvg-convert -w "$size" -h "$size" "$SVG_FILE" -o /tmp/wolf_full.png
    
    # Use ImageMagick to create background and composite
    # -gravity SouthWest positions the logo at bottom-left
    # -geometry +N+N adds padding (5% of size)
    local padding=$((size / 20))
    
    magick -size "${size}x${size}" "xc:${BG_COLOR}" \
           /tmp/wolf_full.png -gravity SouthWest -geometry "+${padding}+${padding}" \
           -composite "$output_file"
    
    echo "  ✓ Created: $output_file"
}

echo "Generating Howlingual icons with bottom-left alignment..."
echo ""

# Generate各sizes
generate_icon 512 "$OUTPUT_DIR/app-icon.png"
generate_icon 1024 "$OUTPUT_DIR/icon.png"
generate_icon 32 "$OUTPUT_DIR/32x32.png"
generate_icon 128 "$OUTPUT_DIR/128x128.png"
generate_icon 256 "$OUTPUT_DIR/128x128@2x.png"

# Convert to ICNS for macOS
echo ""
echo "Converting to ICNS format..."
sips -s format icns "$OUTPUT_DIR/icon.png" --out "$OUTPUT_DIR/icon.icns" > /dev/null 2>&1

echo ""
echo "✅ All icons generated successfully!"
echo ""
echo "Next step: Rebuild the app"
echo "  yarn tauri:build:mac"
