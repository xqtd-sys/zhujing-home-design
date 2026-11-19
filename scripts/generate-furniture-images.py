"""
本地生成家具缩略图（无需联网）。
用法：python scripts/generate-furniture-images.py [sofa|bed|table|cabinet|all]
输出：apps/web/public/furniture/<name>.jpg
"""
import sys
import os
from PIL import Image, ImageDraw, ImageFilter

W, H = 480, 360
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'apps', 'web', 'public', 'furniture')
OUT_DIR = os.path.abspath(OUT_DIR)

BG = (238, 241, 244)
OUTLINE = (63, 111, 99)

# 主题青绿配色
TEAL_DARK = (95, 154, 140)
TEAL = (116, 172, 157)
TEAL_MID = (134, 187, 173)
TEAL_LIGHT = (154, 200, 186)
WOOD = (107, 88, 71)


def new_canvas():
    im = Image.new('RGBA', (W, H), BG + (255,))
    return im, ImageDraw.Draw(im)


def add_shadow(im, box, blur=16, opacity=55):
    layer = Image.new('RGBA', im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse(box, fill=(20, 30, 28, opacity))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    im.alpha_composite(layer)


def rr(d, box, r, fill, outline=None, width=2):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def draw_sofa(im, d):
    add_shadow(im, (95, 268, 390, 320), blur=16, opacity=60)
    # 腿
    for x in (130, 330):
        d.rounded_rectangle((x, 250, x + 16, 292), radius=4, fill=WOOD)
    # 靠背
    rr(d, (100, 92, 380, 205), 26, TEAL_DARK, OUTLINE)
    # 两个靠垫
    rr(d, (120, 112, 235, 198), 18, TEAL_MID, OUTLINE)
    rr(d, (245, 112, 360, 198), 18, TEAL_MID, OUTLINE)
    # 坐垫底座
    rr(d, (82, 182, 398, 258), 20, TEAL, OUTLINE)
    # 两个坐垫
    rr(d, (104, 176, 234, 236), 14, TEAL_LIGHT, OUTLINE)
    rr(d, (246, 176, 376, 236), 14, TEAL_LIGHT, OUTLINE)
    # 扶手
    rr(d, (62, 150, 116, 262), 20, TEAL_DARK, OUTLINE)
    rr(d, (364, 150, 418, 262), 20, TEAL_DARK, OUTLINE)
    # 高光
    d.line((120, 108, 360, 108), fill=(255, 255, 255, 70), width=3)
    d.line((92, 196, 388, 196), fill=(255, 255, 255, 60), width=3)


def draw_bed(im, d):
    add_shadow(im, (70, 270, 410, 322), blur=16, opacity=60)
    # 床架
    rr(d, (80, 150, 400, 285), 16, (150, 128, 96), OUTLINE)
    # 床垫
    rr(d, (92, 130, 388, 230), 18, TEAL_LIGHT, OUTLINE)
    # 被子
    rr(d, (92, 176, 388, 262), 16, TEAL_MID, OUTLINE)
    d.line((92, 176, 388, 176), fill=(255, 255, 255, 70), width=3)
    # 枕头
    rr(d, (112, 112, 226, 176), 16, (246, 244, 236), OUTLINE)
    rr(d, (254, 112, 368, 176), 16, (246, 244, 236), OUTLINE)
    # 床头板
    rr(d, (72, 84, 408, 132), 14, (128, 108, 82), OUTLINE)


def draw_table(im, d):
    add_shadow(im, (75, 268, 405, 322), blur=16, opacity=55)
    # 桌腿
    for x in (110, 158, 322, 370):
        d.rounded_rectangle((x, 196, x + 12, 292), radius=4, fill=(128, 104, 78))
    # 桌面
    rr(d, (80, 158, 400, 208), 18, (168, 142, 114), OUTLINE)
    # 桌面高光
    d.line((96, 166, 384, 166), fill=(255, 255, 255, 80), width=4)
    # 盘子和杯子点缀
    d.ellipse((200, 170, 280, 196), fill=(244, 240, 230), outline=OUTLINE, width=2)
    d.ellipse((300, 172, 336, 194), fill=(226, 232, 236), outline=OUTLINE, width=2)


def draw_cabinet(im, d):
    add_shadow(im, (110, 285, 370, 326), blur=14, opacity=50)
    # 柜体
    rr(d, (120, 70, 360, 300), 12, (141, 155, 145), OUTLINE)
    # 两扇门
    rr(d, (132, 82, 232, 288), 8, (159, 172, 163), OUTLINE)
    rr(d, (248, 82, 348, 288), 8, (159, 172, 163), OUTLINE)
    # 把手
    d.rounded_rectangle((214, 178, 224, 200), radius=4, fill=(90, 100, 92))
    d.rounded_rectangle((256, 178, 266, 200), radius=4, fill=(90, 100, 92))
    # 缝线
    d.line((240, 82, 240, 288), fill=OUTLINE, width=2)


DRAWERS = {
    'sofa': ('sofa.jpg', draw_sofa),
    'bed': ('bed.jpg', draw_bed),
    'table': ('table.jpg', draw_table),
    'cabinet': ('cabinet.jpg', draw_cabinet),
}


def render(key):
    name, fn = DRAWERS[key]
    im, d = new_canvas()
    fn(im, d)
    out = im.convert('RGB')
    path = os.path.join(OUT_DIR, name)
    out.save(path, 'JPEG', quality=90)
    print('saved', path)


if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    arg = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if arg == 'all':
        for k in DRAWERS:
            render(k)
    else:
        render(arg)
