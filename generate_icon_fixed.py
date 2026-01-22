#!/usr/bin/env python3
"""
Generate app icon with wolf at bottom-left corner.
The wolf is scaled to ~70% and positioned flush to bottom-left,
leaving margin space on top and right.
"""
from PIL import Image
import subprocess
import os

SVG_FILE = 'Logo_SVGs_new/Howlingual_icon_ダーク_wolfonly.svg'
ICON_DIR = 'src-tauri/icons'

def generate_icons():
    # Render at large size first
    subprocess.run(['rsvg-convert', '-w', '2048', '-h', '2048', '-b', 'none', SVG_FILE, '-o', '/tmp/wolf_large.png'], check=True)
    
    img = Image.open('/tmp/wolf_large.png').convert('RGBA')
    bbox = img.getbbox()
    if not bbox:
        print("Error: No content found")
        return
    
    wolf = img.crop(bbox)
    orig_w, orig_h = wolf.size
    print(f"Wolf size: {orig_w}x{orig_h}")
    
    os.makedirs(ICON_DIR, exist_ok=True)
    
    # Generate each size
    for target_size, filename in [(1024, 'icon.png'), (512, 'app-icon.png'), (256, '128x128@2x.png'), (128, '128x128.png'), (32, '32x32.png')]:
        canvas = Image.new('RGBA', (target_size, target_size), (0, 0, 0, 0))
        
        # Scale wolf to 70% of icon size to leave room for margins
        wolf_target = int(target_size * 0.70)
        scale = wolf_target / max(orig_w, orig_h)
        new_w, new_h = int(orig_w * scale), int(orig_h * scale)
        
        scaled_wolf = wolf.resize((new_w, new_h), Image.Resampling.LANCZOS)
        
        # Position at bottom-left (x=0, y=size-height)
        paste_x = 0
        paste_y = target_size - new_h
        
        canvas.paste(scaled_wolf, (paste_x, paste_y), scaled_wolf)
        canvas.save(os.path.join(ICON_DIR, filename))
        print(f"Generated: {filename} ({target_size}x{target_size})")
    
    # Generate ICNS
    iconset_dir = '/tmp/howl_icon.iconset'
    os.makedirs(iconset_dir, exist_ok=True)
    
    icon_1024 = Image.open(os.path.join(ICON_DIR, 'icon.png'))
    sizes = [(16, '16x16'), (32, '16x16@2x'), (32, '32x32'), (64, '32x32@2x'),
             (128, '128x128'), (256, '128x128@2x'), (256, '256x256'), (512, '256x256@2x'),
             (512, '512x512'), (1024, '512x512@2x')]
    
    for s, name in sizes:
        icon_1024.resize((s, s), Image.Resampling.LANCZOS).save(os.path.join(iconset_dir, f'icon_{name}.png'))
    
    subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', os.path.join(ICON_DIR, 'icon.icns')], check=True)
    print("Generated: icon.icns")
    print("\nDone! Wolf at 70% size, bottom-left position.")

if __name__ == '__main__':
    generate_icons()
