#!/usr/bin/env python3
import os
from PIL import Image, ImageDraw
from pathlib import Path

BASE_DIR = Path("/Users/spoton/Desktop/SeenProject/seen/seenapp")
ICON_SRC = BASE_DIR / "assets" / "icon.png"
RES_DIR = BASE_DIR / "android/app/src/main/res"

# Standard launcher icon sizes
SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

# Adaptive foreground sizes (usually 108x108 for mdpi, scaled up)
FG_SIZES = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}

def make_round_icon(img, size):
    """Create a circular version of the icon."""
    img = img.resize((size, size), Image.LANCZOS)
    
    # Create a circular mask
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size, size), fill=255)
    
    # Apply mask
    round_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    round_img.paste(img, (0, 0), mask=mask)
    return round_img

def main():
    if not ICON_SRC.exists():
        print(f"Error: Source icon not found at {ICON_SRC}")
        return

    print(f"Loading source icon: {ICON_SRC}")
    src_img = Image.open(ICON_SRC).convert("RGBA")

    for mipmap_dir, size in SIZES.items():
        target_dir = RES_DIR / mipmap_dir
        if not target_dir.exists():
            target_dir.mkdir(parents=True)
            
        print(f"Processing {mipmap_dir}...")
        
        # 1. ic_launcher.png (Square / Legacy)
        img_square = src_img.resize((size, size), Image.LANCZOS)
        img_square.save(target_dir / "ic_launcher.png", "PNG")
        
        # 2. ic_launcher_round.png (Circular)
        img_round = make_round_icon(src_img, size)
        img_round.save(target_dir / "ic_launcher_round.png", "PNG")
        
        # 3. ic_launcher_foreground.png (Adaptive Foreground)
        fg_size = FG_SIZES[mipmap_dir]
        img_fg = src_img.resize((fg_size, fg_size), Image.LANCZOS)
        img_fg.save(target_dir / "ic_launcher_foreground.png", "PNG")

    print("Done generating Android launcher icons!")

if __name__ == "__main__":
    main()
