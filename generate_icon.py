import os
import shutil
import subprocess

def add_white_background_to_svg(svg_path, output_path):
    with open(svg_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Simple insertion of white rect after <svg> tag start
    # Assuming <svg ...> ends with >. Finding the first occurrence of >
    idx = content.find('>')
    if idx == -1:
        print("Invalid SVG")
        return False
    
    # Check if viewBox is present to know dimensions or just use 100%
    new_content = content[:idx+1] + '\n<rect width="100%" height="100%" fill="white"/>' + content[idx+1:]
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    return True

def convert_svg_to_png(svg_path, size=512):
    # Use macOS qlmanage to generate thumbnail
    try:
        subprocess.run(['qlmanage', '-t', '-s', str(size), '-o', '.', svg_path], check=True)
        # qlmanage output filename is usually svg_path + ".png"
        return svg_path + ".png"
    except Exception as e:
        print(f"Error converting SVG: {e}")
        return None

def main():
    svg_source = "static/icon-light.svg"
    temp_svg = "temp_icon_bg.svg"
    target_icon = "src-tauri/icons/icon.png"
    
    if not os.path.exists(svg_source):
        print(f"Source {svg_source} not found")
        return

    print("Adding background...")
    if not add_white_background_to_svg(svg_source, temp_svg):
        return

    print("Converting to PNG...")
    png_path = convert_svg_to_png(temp_svg, 512)
    
    if png_path and os.path.exists(png_path):
        print(f"Moving {png_path} to {target_icon}")
        # Identify if directory exists
        os.makedirs(os.path.dirname(target_icon), exist_ok=True)
        shutil.move(png_path, target_icon)
        
        # Cleanup
        if os.path.exists(temp_svg):
            os.remove(temp_svg)
        print("Done!")
    else:
        print("PNG generation failed.")

if __name__ == "__main__":
    main()
