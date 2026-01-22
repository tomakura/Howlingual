#!/usr/bin/env python3
"""
Generate app icons with bottom-left alignment for Howlingual.
The logo is positioned at the bottom-left corner instead of center.
"""

from PIL import Image, ImageDraw
import subprocess
import os
import tempfile

# Icon sizes needed
SIZES = {
    'app-icon.png': 512,
    'icon.png': 1024,
    '32x32.png': 32,
    '128x128.png': 128,
    '128x128@2x.png': 256,
}

def convert_svg_to_png(svg_path, size):
    """Convert SVG to PNG using rsvg-convert."""
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
        tmp_path = tmp.name
    
    try:
        subprocess.run([
            'rsvg-convert',
            '-w', str(size),
            '-h', str(size),
            '-o', tmp_path,
            svg_path
        ], check=True)
        
        img = Image.open(tmp_path)
        return img
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

def generate_icon_bottom_left(svg_path, output_path, size, background_color=None):
    """
    Generate icon with bottom-left alignment.
    
    Args:
        svg_path: Path to source SVG file
        output_path: Path to output PNG file
        size: Size of output image (square)
        background_color: Background color (None = transparent)
    """
    # Convert SVG to PNG at target size
    logo = convert_svg_to_png(svg_path, size)
    
    # Create transparent background
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    
    # Get the bounding box of non-transparent pixels
    if logo.mode != 'RGBA':
        logo = logo.convert('RGBA')
    
    bbox = logo.split()[3].getbbox()  # Use alpha channel
    
    if bbox:
        # Crop to actual content
        logo_cropped = logo.crop(bbox)
        logo_width, logo_height = logo_cropped.size
        
        # Position at bottom-left corner (no padding - flush against edges)
        x = 0
        y = size - logo_height
        
        # Paste the logo onto background
        img.paste(logo_cropped, (x, y), logo_cropped)
    else:
        # Fallback: paste as-is
        img.paste(logo, (0, 0), logo)
    
    # Save
    img.save(output_path, 'PNG')
    print(f'✓ Generated: {output_path} ({size}x{size})')

def main():
    # Paths
    svg_file = 'Logo_SVGs_new/Howlingual_icon_ダーク_wolfonly.svg'
    output_dir = 'src-tauri/icons'
    
    if not os.path.exists(svg_file):
        print(f'Error: SVG file not found: {svg_file}')
        return
    
    os.makedirs(output_dir, exist_ok=True)
    
    # Generate icons with bottom-left alignment
    print('Generating icons with bottom-left alignment...\n')
    for filename, size in SIZES.items():
        output_path = os.path.join(output_dir, filename)
        generate_icon_bottom_left(svg_file, output_path, size)
    
    # Generate icns file for macOS
    icon_png = os.path.join(output_dir, 'icon.png')
    icon_icns = os.path.join(output_dir, 'icon.icns')
    
    print(f'\nConverting to ICNS format...')
    try:
        subprocess.run([
            'sips', '-s', 'format', 'icns',
            icon_png, '--out', icon_icns
        ], check=True, capture_output=True)
        print(f'✓ Generated: {icon_icns}')
    except subprocess.CalledProcessError as e:
        print(f'Warning: Could not generate ICNS: {e}')
        print('You can manually convert using: sips -s format icns icon.png --out icon.icns')
    
    print('\n✅ All icons generated successfully!')
    print('\nNext step: Rebuild the app with: yarn tauri:build:mac')

if __name__ == '__main__':
    main()
