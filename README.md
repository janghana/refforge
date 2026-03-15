# 📎 RefForge

> DOI · arXiv · Paper Title → BibTeX & Numbered References

Paste paper references line by line and instantly convert them to BibTeX (`.bib`) or Numbered (`[1]...`) format.

**🔗 [Live Demo →](https://refforge.vercel.app)**

---

## Features

- **Multi-source parallel search** — Queries Semantic Scholar (Match + Search), arXiv, and CrossRef simultaneously for maximum accuracy
- **Citation-weighted exact matching** — Exact title matches get priority; among similar titles, the most-cited original paper wins
- **DOI** — Fetches precise metadata from CrossRef API
- **arXiv ID** — Parses directly from arXiv API
- **Paper title** — 4-source search with intelligent scoring to find the right paper
- **Auto cite key** — Generates keys like `vaswani2017attention` (author + year + keyword)
- **Two output formats** — BibTeX (for LaTeX) / Numbered (for Word submissions)
- **Drag & Drop** — Drop `.txt`, `.csv`, or `.md` files directly
- **Copy / Download** — One-click clipboard copy or file download
- **Project management** — Organize references by project with sidebar navigation
- **Smart caching** — Fuzzy title cache to avoid redundant API calls
- **No server required** — Runs entirely in the browser (no backend)
- **No sign-up required**

## Quick Start

```bash
git clone https://github.com/janghana/refforge.git
cd refforge
npm install
npm run dev
```

Open `http://localhost:5173/` in your browser.

## Input Format

One reference per line — any format works:

```
# Lines starting with '#' are comments (ignored)
10.1016/j.neucom.2019.04.019
https://doi.org/10.1038/s41586-023-06747-5
2010.11929
arxiv:2301.12345
https://arxiv.org/abs/2301.12345
Attention Is All You Need
```

## Output Examples

### BibTeX

```bibtex
@article{vaswani2017attention,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish and Shazeer, Noam and ...},
  journal = {Advances in Neural Information Processing Systems},
  year = {2017},
  doi = {10.48550/arXiv.1706.03762},
  eprint = {1706.03762},
  archivePrefix = {arXiv}
}
```

### Numbered

```
[1] Ashish Vaswani, Noam Shazeer, ... Attention Is All You Need.
    Advances in Neural Information Processing Systems. 2017. arXiv:1706.03762
```

## Search Algorithm

RefForge uses a multi-source parallel search strategy:

1. **Semantic Scholar Match** — Exact title lookup via S2 match endpoint
2. **Semantic Scholar Search** — Ranked keyword search with citation weighting
3. **arXiv Search** — Title keyword search across arXiv entries
4. **CrossRef Search** — Title query against CrossRef database

Results are scored using: `exactMatchBonus (500k) + similarity × 50k + log10(citations) × 10k`

This ensures the original, highly-cited paper always wins over similarly-named derivatives.

## Deploy

### Vercel (Recommended)

```bash
npm run build
npx vercel --prod
```

### GitHub Pages

1. Set `base: '/refforge/'` in `vite.config.js`
2. Go to Settings → Pages → Source: **GitHub Actions**
3. Push to `main` — auto build & deploy
4. Access at `https://YOUR_USERNAME.github.io/refforge/`

## Tech Stack

- **Vite** + **React 18**
- **Semantic Scholar API** (title matching + enrichment)
- **CrossRef REST API** (DOI → metadata)
- **arXiv API** (arXiv ID → metadata)
- Zero external libraries beyond React

## Contributing

PRs are welcome! Some ideas for future features:

- [ ] PubMed ID support
- [ ] Citation Style Language (CSL) support
- [ ] `.docx` export (Vancouver, APA, etc.)
- [ ] Bulk import from Zotero / EndNote
- [ ] Shared project collaboration via cloud DB

## License

MIT
