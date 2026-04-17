"""One-shot: inspect the Canva template to locate the QR image and CARD ID text."""
from pathlib import Path
import fitz  # PyMuPDF

TEMPLATE = Path(r"C:\Users\sayvi\OneDrive - Viva Foods\Marketing's files - Social Media & Marketing by VV\Canva Designs Archive\Yolkshire Loyalty Program - 3.5 x 2 inch.pdf")

doc = fitz.open(TEMPLATE)
for i, page in enumerate(doc, 1):
    print(f"\n=== Page {i} ===")
    print(f"  Size (pt):  {page.rect.width:.2f} x {page.rect.height:.2f}  "
          f"(= {page.rect.width/72:.3f} x {page.rect.height/72:.3f} in)")

    # Images
    imgs = page.get_images(full=True)
    print(f"  Images: {len(imgs)}")
    for idx, img in enumerate(imgs):
        xref = img[0]
        for rect in page.get_image_rects(xref):
            w, h = rect.width, rect.height
            print(f"    img#{idx} xref={xref}: rect=({rect.x0:.1f},{rect.y0:.1f})->({rect.x1:.1f},{rect.y1:.1f})  "
                  f"{w:.1f}x{h:.1f} pt  (= {w/72:.2f}x{h/72:.2f} in)")

    # Text blocks we care about
    for target in ["CARD ID", "THE", "GOLDEN", "YOLK", "CARD"]:
        hits = page.search_for(target)
        for r in hits:
            print(f"  text '{target}': ({r.x0:.1f},{r.y0:.1f})->({r.x1:.1f},{r.y1:.1f})")
