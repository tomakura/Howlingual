
from PIL import Image
import subprocess
import os

SVG_WOLF_ONLY = 'Logo_SVGs_new/Howlingual_icon_ダーク_wolfonly.svg'
TEMP_PNG = '/tmp/wolf_render_full.png'
ICON_DIR = 'src-tauri/icons'

def fix_alignment_perfectly():
    # 1. Render at 1024x1024
    subprocess.run(['rsvg-convert', '-w', '1024', '-h', '1024', '-b', 'none', SVG_WOLF_ONLY, '-o', TEMP_PNG], check=True)
    
    img = Image.open(TEMP_PNG).convert('RGBA')
    bbox = img.getbbox() # (left, top, right, bottom)
    if not bbox:
        print("Error: No content")
        return
        
    left, top, right, bottom = bbox
    w, h = right - left, bottom - top
    
    print(f"Wolf bbox: {bbox} (size {w}x{h})")
    
    # Position goal: flush bottom-left in a square
    # We want to fill most of the icon, but let's give it a TINY bit of padding (say 2%) 
    # to avoid extreme clipping by squircle corners, or just make it dead flush if requested.
    # The user said "Eliminate extra margins", let's try 1% padding.
    
    PADDING = 5 # pixels at 1024
    TARGET_SIZE = 1024
    
    # Scaled size
    # Let's make the wolf fill 85% of the icon to look "correct" on macOS
    target_filled_size = int(TARGET_SIZE * 0.9) 
    scale = target_filled_size / max(w, h)
    
    new_w, new_h = int(w * scale), int(h * scale)
    
    wolf_img = img.crop(bbox).resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    # Use transparent background - let macOS apply its own squircle background
    BG_COLOR = (0, 0, 0, 0)  # Transparent
    
    final_img = Image.new('RGBA', (TARGET_SIZE, TARGET_SIZE), BG_COLOR)
    # Paste at bottom-left with tiny padding
    paste_x = PADDING
    paste_y = TARGET_SIZE - new_h - PADDING
    
    final_img.paste(wolf_img, (paste_x, paste_y), wolf_img)
    
    # Save all formats
    os.makedirs(ICON_DIR, exist_ok=True)
    final_img.save(os.path.join(ICON_DIR, 'icon.png'))
    final_img.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(ICON_DIR, 'app-icon.png'))
    final_img.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(ICON_DIR, '32x32.png'))
    final_img.resize((128, 128), Image.Resampling.LANCZOS).save(os.path.join(ICON_DIR, '128x128.png'))
    final_img.resize((256, 256), Image.Resampling.LANCZOS).save(os.path.join(ICON_DIR, '128x128@2x.png'))

    # ICNS
    iconset_dir = '/tmp/final_icon.iconset'
    os.makedirs(iconset_dir, exist_ok=True)
    sizes = [(16, '16x16'), (32, '16x16@2x'), (32, '32x32'), (64, '32x32@2x'), 
             (128, '128x128'), (256, '128x128@2x'), (256, '256x256'), (512, '256x256@2x'),
             (512, '512x512'), (1024, '512x512@2x')]
    
    for s, name in sizes:
        final_img.resize((s, s), Image.Resampling.LANCZOS).save(os.path.join(iconset_dir, f'icon_{name}.png'))
        
    subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', os.path.join(ICON_DIR, 'icon.icns')], check=True)
    print("Final icons generated with #1a1a1a background and 90% wolf at bottom-left.")

if __name__ == '__main__':
    fix_alignment_perfectly()
