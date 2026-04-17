"""Overlay unique QR + card ID onto the Canva template PDF for each of 999 cards.

Outputs two PDFs in ./print/:
  cards-front.pdf  — 1 page, identical for every card (run 999 copies)
  cards-back.pdf   — 999 pages, one per card (YSLC001..YSLC999)

Install once: pip install pymupdf
Run sample:   python build_cards_pdf.py --sample        (first 3 cards only)
Run full:     python build_cards_pdf.py                 (all 999)
"""
import argparse
from pathlib import Path
import fitz  # PyMuPDF

TEMPLATE = Path(r"C:\Users\sayvi\OneDrive - Viva Foods\Marketing's files - Social Media & Marketing by VV\Canva Designs Archive\Yolkshire Loyalty Program - 3.5 x 2 inch.pdf")
HERE     = Path(__file__).parent
QR_DIR   = HERE / "qrs"
OUT_DIR  = HERE / "print"
OUT_DIR.mkdir(exist_ok=True)

# --- Coordinates on page 2 (the back) ---
# Template page size: 286.02 x 178.02 pt (3.972 x 2.472 in incl. 3 mm bleed).
# Trim area: x=17..269, y=17..161.
# Green panel sits on the right, "CARD ID" label measured at (214.4, 96.2)-(239.9, 103.6).
# "THE GOLDEN YOLK CARD" title starts at y~110; QR placeholder sits above "CARD ID" label.

# Box where the per-card QR image goes — tweak if misaligned with the template's
# placeholder QR after viewing the sample.
QR_RECT = fitz.Rect(190, 20, 258, 88)      # ~68 pt square, centered in the green panel

# Box to place the actual "YSLC###" text.
# Strategy: redact (paint over) the existing "CARD ID" label in panel green,
# then write the real card ID there in white, matching the label's styling.
CARD_ID_LABEL_RECT = fitz.Rect(210, 94, 245, 106)  # the "CARD ID" text from probe
CARD_ID_TEXT_RECT  = fitz.Rect(200, 93,  258, 107) # slightly wider for "YSLC001"

PANEL_COLOR = (52/255, 87/255, 54/255)     # #345736 dark green
TEXT_COLOR  = (1, 1, 1)                    # white


def build(sample: bool) -> None:
    tpl = fitz.open(TEMPLATE)

    # Front: single page, identical for all cards.
    front = fitz.open()
    front.insert_pdf(tpl, from_page=0, to_page=0)
    front_path = OUT_DIR / ("cards-front-sample.pdf" if sample else "cards-front.pdf")
    front.save(front_path)
    front.close()
    print(f"  front -> {front_path.name}")

    # Backs: one page per card.
    backs = fitz.open()
    limit = 4 if sample else 1000  # sample = YSLC001..YSLC003
    for i in range(1, limit):
        card_id = f"YSLC{i:03d}"
        qr_png = QR_DIR / f"{card_id}.png"
        if not qr_png.exists():
            print(f"  !! missing {qr_png.name}, skipping")
            continue

        backs.insert_pdf(tpl, from_page=1, to_page=1)
        page = backs[-1]

        # 1. Paint over the existing "CARD ID" label text in the panel color.
        page.add_redact_annot(CARD_ID_LABEL_RECT, fill=PANEL_COLOR)
        page.apply_redactions()

        # 2. Drop the per-card QR PNG over the vector placeholder QR.
        page.insert_image(QR_RECT, filename=str(qr_png))

        # 3. Write the YSLC### value where the "CARD ID" label used to be.
        page.insert_textbox(
            CARD_ID_TEXT_RECT,
            card_id,
            fontsize=8,
            fontname="hebo",   # Helvetica Bold (built-in)
            color=TEXT_COLOR,
            align=fitz.TEXT_ALIGN_CENTER,
        )

        if not sample and i % 100 == 0:
            print(f"  ...{i}/999 back pages")

    back_path = OUT_DIR / ("cards-back-sample.pdf" if sample else "cards-back.pdf")
    page_count = len(backs)
    backs.save(back_path, deflate=True, deflate_images=True, deflate_fonts=True)
    backs.close()
    tpl.close()
    print(f"  back  -> {back_path.name}  ({page_count} pages)")
    print(f"Done. Output folder: {OUT_DIR.resolve()}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--sample", action="store_true", help="generate first 3 cards only")
    args = p.parse_args()
    build(sample=args.sample)
