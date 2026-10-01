# docs

Reference material for building Zora Pro ERP. Nothing here is compiled; it is what the code must follow.

| Folder | Contents | Read when |
|---|---|---|
| `design/mockups/` | Approved screens as HTML. Open `index.html` in a browser and click through | Before building any screen |
| `design/screenshots/` | The same screens as PNG images, named by screen code (`P09-PoList.png`) | Quick look, or when HTML is not convenient |
| `design/SCREENS.md` | Screen code → mockup → route → API | Planning a screen |
| `design/SEED_DATA.md` | The demo data the mockups use | Writing the seed, checking a screen |
| `design/DESIGN_TOKENS.md` | Colours, type, chips, buttons per module | Styling |
| `integration/MASTER_DATA_CONTRACT.md` | Shared codes and fields Master Data owns, for Sales, Purchase, WMS and MES | Any field that comes from Master Data |
| `integration/EVENTS.md` | Events between modules | Anything another module needs to know about |
| `requirements/ERP_SRS.md` / `.docx` | Software requirements specification | Detailed requirements |
| `requirements/ERP_SDD.md` / `.docx` | Software design document | Architecture detail. Where it disagrees with `CLAUDE.md`, `CLAUDE.md` wins |

Recommended reading order for a new developer: `CLAUDE.md` → `design/mockups/PurUxGuide.html` → `design/mockups/FlowP1.html` … `FlowP7.html` → `design/SCREENS.md`.
