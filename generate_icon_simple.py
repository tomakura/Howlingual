#!/usr/bin/env python3
"""
Generate app icon from SVG by simply scaling it.
The SVG itself should be designed with proper margins for bottom-left alignment.
"""

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

def convert_svg_to_icon(svg_path, output_path, size):
    """Convert SVG directly to PNG at specified size."""
    subprocess.run([
        'rsvg-convert',
        '-w', str(size),
        '-h', str(size),
        '-b', 'none',  # Transparent background
        '-o', output_path,
        svg_path
    ], check=True)
    print(f'✓ Generated: {output_path} ({size}x{size})')

def main():
    # Use the final white wolf SVG with proper margins for bottom-left alignment
    svg_file = 'Logo_SVGs_new/Howlingual_icon_final.svg'
    output_dir = 'src-tauri/icons'
    
    if not os.path.exists(svg_file):
        print(f'Error: SVG file not found: {svg_file}')
        return
    
    os.makedirs(output_dir, exist_ok=True)
    
    # Generate icons by simply scaling SVG
    print('Generating icons from SVG...\n')
    for filename, size in SIZES.items():
        output_path = os.path.join(output_dir, filename)
        convert_svg_to_icon(svg_file, output_path, size)
    
    # Generate icns file for macOS
    icon_png = os.path.join(output_dir, 'icon.png')
    icon_icns = os.path.join(output_dir, 'icon.icns')
    
    print(f'\nCreating iconset for ICNS...')
    iconset_dir = '/tmp/icon.iconset'
    os.makedirs(iconset_dir, exist_ok=True)
    
    # Create all required sizes for iconset
    sizes_map = [
        (16, 'icon_16x16.png'),
        (32, 'icon_16x16@2x.png'),
        (32, 'icon_32x32.png'),
        (64, 'icon_32x32@2x.png'),
        (128, 'icon_128x128.png'),
        (256, 'icon_128x128@2x.png'),
        (256, 'icon_256x256.png'),
        (512, 'icon_256x256@2x.png'),
        (512, 'icon_512x512.png'),
        (1024, 'icon_512x512@2x.png'),
    ]
    
    for size, filename in sizes_map:
        output = os.path.join(iconset_dir, filename)
        subprocess.run(['sips', '-z', str(size), str(size), icon_png, '--out', output], 
                      check=True, capture_output=True)
    
    # Convert to ICNS
    subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', icon_icns], check=True)
    print(f'✓ Generated: {icon_icns}')
    
    print('\n✅ All icons generated successfully!')
    print('\nNote: The SVG should have proper margins (right-top space)')
    print('      so the logo appears at bottom-left when scaled.')

if __name__ == '__main__':
    main()
