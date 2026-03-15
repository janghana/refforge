# 📎 RefForge

> DOI · arXiv · 논문 제목 → BibTeX & Numbered References

논문 레퍼런스를 한 줄씩 붙여넣으면 BibTeX(`.bib`)와 Numbered(`[1]...`) 형식으로 일괄 변환합니다.

**🔗 [Live Demo →](https://YOUR_USERNAME.github.io/refforge/)**

---

## Features

- **DOI** → Crossref API로 정확한 메타데이터 추출
- **arXiv ID** → arXiv API로 자동 파싱
- **논문 제목** → Crossref 검색 → DOI 매칭 → BibTeX 생성
- **Cite key 자동 생성** — `guo2019lseg` 형식 (`저자+년도+제목키워드`)
- **두 가지 출력 형식** — BibTeX (LaTeX용) / Numbered (Word 투고용)
- **파일 Drag & Drop** — `.txt`, `.csv`, `.md` 파일 끌어다 놓기
- **Copy / Download** — 클립보드 복사 또는 파일 다운로드
- **서버 불필요** — 브라우저에서 직접 API 호출 (백엔드 없음)
- **회원가입 불필요**

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/refforge.git
cd refforge
npm install
npm run dev
```

브라우저에서 `http://localhost:5173/refforge/` 접속.

## 입력 형식

한 줄에 하나씩, 아무 형식이나 OK:

```
# '#'은 주석 (무시됨)
10.1016/j.neucom.2019.04.019
https://doi.org/10.1038/s41586-023-06747-5
2010.11929
arxiv:2301.12345
https://arxiv.org/abs/2301.12345
Attention Is All You Need
```

## 출력 예시

### BibTeX

```bibtex
@article{guo2019lseg,
  title = {L-Seg: An end-to-end unified framework...},
  author = {Guo, Song and Li, Tao and ...},
  journal = {Neurocomputing},
  volume = {349},
  pages = {52--63},
  year = {2019},
  doi = {10.1016/j.neucom.2019.04.019},
  publisher = {Elsevier BV}
}
```

### Numbered

```
[1] Song Guo, Tao Li, ... L-Seg: An end-to-end unified framework...
    Neurocomputing. 2019;349:52--63. doi:10.1016/j.neucom.2019.04.019
```

## Deploy

### GitHub Pages (추천)

1. GitHub에 repo 생성
2. `vite.config.js`에서 `base`를 repo 이름으로 확인
3. Settings → Pages → Source: **GitHub Actions**
4. `git push origin main` → 자동 빌드/배포
5. `https://YOUR_USERNAME.github.io/refforge/` 에서 접속

### Vercel

```bash
npm i -g vercel
vercel
```

커스텀 도메인도 무료.

## Tech Stack

- **Vite** + **React 18**
- **Crossref REST API** (DOI → 메타데이터)
- **arXiv API** (arXiv ID → 메타데이터)
- 외부 라이브러리 0개 (React만 사용)

## Contributing

PR 환영합니다! 특히 이런 기능이 있으면 좋겠다면:

- [ ] `.docx` 직접 다운로드 (Vancouver style 등)
- [ ] Citation Style Language (CSL) 지원
- [ ] PubMed ID 지원
- [ ] 중복 DOI 감지
- [ ] Bulk import from Zotero/EndNote

## License

MIT
