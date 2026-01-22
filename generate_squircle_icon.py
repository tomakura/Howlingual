#!/usr/bin/env python3
"""
Generate app icon with:
- Squircle (rounded corners) baked into the icon
- Wolf centered
- No extra margins
- Dark background
"""
from PIL import Image, ImageDraw
import subprocess
import os
import math

SVG_FILE = 'Logo_SVGs_new/Howlingual_icon_ダーク_wolfonly.svg'
ICON_DIR = 'src-tauri/icons'
BG_COLOR = (0, 0, 0, 0)  # Transparent - no background

def create_squircle_mask(size, radius_ratio=0.225):
    """Create a squircle mask (iOS-style rounded rectangle)"""
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    
    # Calculate corner radius (macOS uses about 22.5% of the icon size)
    radius = int(size * radius_ratio)
    
    # Draw rounded rectangle
    draw.rounded_rectangle(
        [(0, 0), (size - 1, size - 1)],
        radius=radius,
        fill=255
    )
    
    return mask

def generate_icons():
    # Render wolf at high resolution
    subprocess.run(['rsvg-convert', '-w', '2048', '-h', '2048', '-b', 'none', SVG_FILE, '-o', '/tmp/wolf_hires.png'], check=True)
    
    wolf = Image.open('/tmp/wolf_hires.png').convert('RGBA')
    bbox = wolf.getbbox()
    if not bbox:
        print("Error: No content")
        return
    
    wolf_cropped = wolf.crop(bbox)
    orig_w, orig_h = wolf_cropped.size
    print(f"Wolf size: {orig_w}x{orig_h}")
    
    os.makedirs(ICON_DIR, exist_ok=True)
    
    sizes = [
        (1024, 'icon.png'),
        (512, 'app-icon.png'),
        (256, '128x128@2x.png'),
        (128, '128x128.png'),
        (32, '32x32.png'),
    ]
    
    for target_size, filename in sizes:
        # Create dark background
        canvas = Image.new('RGBA', (target_size, target_size), BG_COLOR)
        
        # Scale wolf to fill the icon (100%, no margin)
        scale = target_size / max(orig_w, orig_h)
        new_w, new_h = int(orig_w * scale), int(orig_h * scale)
        
        scaled_wolf = wolf_cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
        
        # Center the wolf
        paste_x = (target_size - new_w) // 2
        paste_y = (target_size - new_h) // 2
        
        canvas.paste(scaled_wolf, (paste_x, paste_y), scaled_wolf)
        
        # Apply squircle mask
        mask = create_squircle_mask(target_size)
        
        # Create final image with transparency outside squircle
        result = Image.new('RGBA', (target_size, target_size), (0, 0, 0, 0))
        result.paste(canvas, (0, 0), mask)
        
        result.save(os.path.join(ICON_DIR, filename))
        print(f"Generated: {filename} ({target_size}x{target_size})")
    
    # Generate ICNS
    iconset_dir = '/tmp/squircle_icon.iconset'
    os.makedirs(iconset_dir, exist_ok=True)
    
    icon_1024 = Image.open(os.path.join(ICON_DIR, 'icon.png'))
    icns_sizes = [
        (16, '16x16'), (32, '16x16@2x'), (32, '32x32'), (64, '32x32@2x'),
        (128, '128x128'), (256, '128x128@2x'), (256, '256x256'), (512, '256x256@2x'),
        (512, '512x512'), (1024, '512x512@2x')
    ]
    
    for s, name in icns_sizes:
        icon_1024.resize((s, s), Image.Resampling.LANCZOS).save(os.path.join(iconset_dir, f'icon_{name}.png'))
    
    subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', os.path.join(ICON_DIR, 'icon.icns')], check=True)
    print("Generated: icon.icns")
    print("\nDone! Squircle icon with centered wolf, no margins.")

if __name__ == '__main__':
    generate_icons()
