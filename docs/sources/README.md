# Source documents and ingestion record

These are the two PDFs supplied for this project. Their original names and bytes are unchanged.
The PDFs remain authoritative. The Markdown derivatives preserve page numbers and distinguish extracted source text from reconstructed visual content.
This repository contains exactly two PDFs. Additional presentation exports must use another location or a different format.

### Assignment

[Original PDF](Computer_Network_Term_Project___Socket_Programming-1047532-17880926607939.pdf) · [Page-oriented Markdown](../ingested/assignment/Computer_Network_Term_Project___Socket_Programming-1047532-17880926607939.pdf.md) · [Manifest](../ingested/assignment/Computer_Network_Term_Project___Socket_Programming-1047532-17880926607939.pdf.manifest.json)

Pages: 2. Bytes: 255654.

SHA-256: `6ac5f0db4fffbb5b70b9d57823377fbff0c77affde79cb0ff8b1bfa42b117647`

### Implementation Explanation template

[Original PDF](Computer_Network_Term_Project___Socket_Programming___Implementation_Explanation-1047532-17880926752070.pdf) · [Page-oriented Markdown](../ingested/implementation-explanation/Computer_Network_Term_Project___Socket_Programming___Implementation_Explanation-1047532-17880926752070.pdf.md) · [Manifest](../ingested/implementation-explanation/Computer_Network_Term_Project___Socket_Programming___Implementation_Explanation-1047532-17880926752070.pdf.manifest.json)

Pages: 20. Bytes: 89557.

SHA-256: `1c7057d4c5cb2e8143672e067b9c3b7d18f124749a403225b10d1659d6056d7a`
## Ingestion method

The `my-parse-pdf` skill prepared both documents with PyMuPDF 1.28.2 at 200 DPI on 2026-11-01.
The preparation step extracted embedded text and images, rendered every page, and recorded source hashes and page geometry.
An agent visually inspected all 22 page renders and reconciled the Markdown. No unreadable regions remain.
Poppler independently rendered assignment page 2 and template page 17 for a second-renderer comparison. Text, numerals, and layout agree.

Each derivative directory contains a schema-version-2 manifest and `assets/pages/page-NNNN.png` for every page.
The assignment derivative also contains its embedded diagram and a 300-DPI source crop.
The manifest records the crop rectangle in PDF points. Reconstruction notes describe the diagram and the four blank feature slots.
The presentation derivative explicitly identifies empty template fields. It contains no completed team slides or code screenshots.

The parser is a preparation tool, not a visual reviewer. After any parser rerun, inspect every page again and update the review status.
Do not mark an incomplete review as complete. Preserve explicit gaps if a future source contains unreadable content.

## Manual integrity check

From the repository root, run:

```sh
find docs/sources -maxdepth 1 -type f -name '*.pdf' -exec sha256sum {} +
```

Compare both hashes with the values above and in the manifests. Also make sure that the entire repository contains exactly two PDF files.
