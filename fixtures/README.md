# Seed fixtures

Three intentionally-messy test files so you can exercise the ingest pipeline
end-to-end without hunting for real legal documents. The point is to show the
pipeline degrading **gracefully** on noisy input, not to demo perfect OCR.

- `clean-complaint.txt` — well-structured plain text. Native-text path, OCR
  bypassed, high confidence. Baseline for the happy case.
- `scan-deed.txt` — text representing a low-res scan. Has the kinds of
  artifacts Tesseract typically produces (smudged characters, broken words,
  inconsistent line breaks). Indexes fine but flagged with low confidence on
  several "pages."
- `notes-handwritten.txt` — text representing a partially-illegible handwritten
  page. Heavily punctuated with [illegible] markers, intentionally sparse.
  Should trip the low-confidence badge AND produce an "Open Questions" entry
  in the generated Case Fact Summary.

For a realer demo, replace these with actual PDFs (a clean PDF, a 150 DPI
scan, and a photo of a handwritten page).
