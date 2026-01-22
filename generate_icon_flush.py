
from PIL import Image
import os
import subprocess

SVG_FILE = 'Logo_SVGs_new/Howlingual_icon_ダーク_wolfonly.svg'
TEMP_PNG = '/tmp/wolf_render_temp.png'
ICON_DIR = 'src-tauri/icons'
SIZES = [32, 128, 256, 512, 1024]

def generate_flush_icons():
    # 1. Render SVG to a large PNG to get accurate bbox
    subprocess.run(['rsvg-convert', '-w', '2048', '-h', '2048', '-b', 'none', SVG_FILE, '-o', TEMP_PNG], check=True)
    
    img = Image.open(TEMP_PNG).convert('RGBA')
    bbox = img.getbbox() # (left, top, right, bottom)
    if not bbox:
        print("Error: Could not find any content in SVG")
        return

    # Extract the wolf
    wolf = img.crop(bbox)
    w_width, w_height = wolf.size
    
    print(f"Original wolf size: {w_width}x{w_height} at {bbox}")

    os.makedirs(ICON_DIR, exist_ok=True)

    for size in SIZES:
        # Create a square transparent canvas
        canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        
        # Scale the wolf to fit while maintaining aspect ratio
        # We want the wolf to be prominent, but how big?
        # If we make it flush, it should occupy as much space as the user wants.
        # Let's say it occupies 90% of the height or width?
        # Actually, the user wants it at the bottom-left. 
        # "Provide margins on the right and top" implies it shouldn't fill the whole square.
        # Let's try making it 75% of the square size.
        
        scale = (size * 0.8) / max(w_width, w_height)
        new_w = int(w_width * scale)
        new_h = int(w_height * scale)
        
        scaled_wolf = wolf.resize((new_w, new_h), Image.Resampling.LANCZOS)
        
        # Paste at bottom-left corner (0, size - new_h)
        canvas.paste(scaled_wolf, (0, size - new_h), scaled_wolf)
        
        # Save
        if size == 512:
            canvas.save(os.path.join(ICON_DIR, 'app-icon.png'))
        elif size == 1024:
            canvas.save(os.path.join(ICON_DIR, 'icon.png'))
        
        if size == 32:
            canvas.save(os.path.join(ICON_DIR, '32x32.png'))
        elif size == 128:
            canvas.save(os.path.join(ICON_DIR, '128x128.png'))
        elif size == 256:
            canvas.save(os.path.join(ICON_DIR, '128x128@2x.png'))

    # Also generate ICNS
    icon_png = os.path.join(ICON_DIR, 'icon.png')
    iconset_dir = '/tmp/icon.iconset'
    os.makedirs(iconset_dir, exist_ok=True)
    
    sizes_map = [
        (16, 'icon_16x16.png'), (32, 'icon_16x16@2x.png'),
        (32, 'icon_32x32.png'), (64, 'icon_32x32@2x.png'),
        (128, 'icon_128x128.png'), (256, 'icon_128x128@2x.png'),
        (256, 'icon_256x256.png'), (512, 'icon_256x256@2x.png'),
        (512, 'icon_512x512.png'), (1024, 'icon_512x512@2x.png'),
    ]
    
    for s, name in sizes_map:
        subprocess.run(['sips', '-z', str(s), str(s), icon_png, '--out', os.path.join(iconset_dir, name)], check=True, capture_output=True)
    
    subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', os.path.join(ICON_DIR, 'icon.icns')], check=True)
    print("Icons generated successfully.")

if __name__ == '__main__':
    generate_flush_icons()
