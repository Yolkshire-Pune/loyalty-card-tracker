"""Generate 999 branded QR PNGs + CSVs for Yolkshire's Golden Yolk Loyalty Program.

Output:
  ./qrs/YSLC001.png ... ./qrs/YSLC999.png   — 999 QR images
  ./qrs.csv                                 — generic CSV (Canva, Figma, etc.)
  ./qrs-indesign.csv                        — InDesign Data Merge CSV (image column @-prefixed)

Install once: pip install "qrcode[pil]"
Run:          python generate_qrs.py
Re-running is safe — existing PNGs are skipped; CSVs always re-emit.
"""
import csv
from pathlib import Path
from qrcode.main import QRCode
from qrcode.constants import ERROR_CORRECT_H
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers.pil import RoundedModuleDrawer
from qrcode.image.styles.colormasks import SolidFillColorMask

BASE_URL     = "https://yolkshire-pune.github.io/loyalty-card-tracker/?id="
QR_HOST_URL  = "https://yolkshire-golden-yolk-qr.netlify.app/"   # public host for QR PNGs (Canva Bulk Create)
HERE         = Path(__file__).parent
OUT_DIR      = HERE / "qrs"
LOGO         = HERE.parent / "yolkshire-new-logo-fhd.png"   # repo-root logo, not duplicated

# Brand palette (RGB)
GOLD       = (245, 185, 52)   # #f5b934 — QR modules (foreground)
DARK_GREEN = (52,  87, 54)    # #345736 — background

OUT_DIR.mkdir(exist_ok=True)
generated, skipped = 0, 0

# Standard CSV: works for Canva Bulk Create, Figma plugins, any spreadsheet import.
std_csv = HERE / "qrs.csv"
# InDesign Data Merge CSV: image column header must start with @ and contain a path
# relative to the CSV's location (InDesign looks up the image at merge time).
id_csv  = HERE / "qrs-indesign.csv"

with std_csv.open('w', newline='', encoding='utf-8') as fs, \
     id_csv.open('w', newline='', encoding='utf-8') as fi:
    w_std = csv.writer(fs); w_std.writerow(['card_id', 'qr_filename', 'qr_url', 'url'])
    w_id  = csv.writer(fi); w_id.writerow(['card_id', '@qr_image', 'url'])

    for i in range(1, 1000):                       # YSLC001 … YSLC999
        card_id  = f"YSLC{i:03d}"
        filename = f"{card_id}.png"
        url      = BASE_URL + card_id
        out_path = OUT_DIR / filename

        if out_path.exists():
            skipped += 1
        else:
            qr = QRCode(error_correction=ERROR_CORRECT_H, box_size=12, border=2)
            qr.add_data(url)
            qr.make(fit=True)
            kwargs = {
                "image_factory": StyledPilImage,
                "module_drawer": RoundedModuleDrawer(),
                "color_mask":    SolidFillColorMask(back_color=DARK_GREEN, front_color=GOLD),
            }
            if LOGO.exists():
                kwargs["embeded_image_path"] = str(LOGO)
            qr.make_image(**kwargs).save(out_path)
            generated += 1
            if generated % 100 == 0:
                print(f"  ...{generated} new QRs generated")

        qr_url = QR_HOST_URL + filename
        w_std.writerow([card_id, filename, qr_url, url])
        w_id.writerow([card_id, f"qrs/{filename}", url])

print(f"Done — {generated} new, {skipped} skipped. PNGs: {OUT_DIR.resolve()}")
print(f"       CSVs: {std_csv.name}, {id_csv.name}")
