# Dashboard look: spec for a Python-built dashboard

Goal: a page made by a Python script (plain HTML, Jinja, Streamlit, Dash, NiceGUI, Panel ...) that looks like the vault's cards, badges, chips and buttons. Everything here is read from the plugin and snippet code, not measured on screen: compare against `docs/reference/visual/` (the approved screenshots; local only) and say what differs.

**Files:** `lab-kit-dashboard.css` (copy it next to the script; every colour, size and class below is in it) and this spec. Sources of truth if the vault changes: `kits/planning/.obsidian/snippets/vault-colours.css` (colours), `vault-theme.css` (cards, badges), `styles.css` (chips, windows), `docs/design-standard.md` (shapes).

## 1. Base colours: copy them from YOUR theme
The vault uses Obsidian's theme variables for the page, text and accent. The CSS file defaults to Obsidian's stock dark / light values. If your vault uses another theme, open the vault, DevTools (Ctrl/Cmd+Shift+I), select `body` and copy these variables into the `:root` blocks: `--background-primary`, `--background-secondary`, `--background-modifier-border`, `--background-modifier-hover`, `--text-normal`, `--text-muted`, `--interactive-accent`, `--text-accent`. Nothing else depends on the theme.

## 2. Meaning colours (the rule that matters most)
Colour says what something IS, never decoration. Six hues, each with a base (tints, borders) and a lighter-in-dark / darker-in-light text shade, kept the same hue:

| Meaning | Hue | Use for |
|---|---|---|
| doing | blue | focus, Started, today |
| project | purple | projects |
| waiting | amber | planning, processing results, carried over |
| done | green | lab, closed, done, active |
| neutral | slate | planned, backlog, navigation |
| overdue | red | overdue ONLY |

Text in a hue uses `rgb(var(--vt-<hue>-text))`; fills use `rgba(var(--vt-<hue>), 0.22)` (badge) or `0.14` (column). Headings: h2 amber, h3 blue, h4 green; links blue, hover amber. Aim for ≥ 4.5:1 text contrast.

## 3. Shapes (four sizes, never a number)
| Variable | px | Use |
|---|---|---|
| `--lk-radius-card` | 14 | cards, tiles, windows |
| `--lk-radius-control` | 10 | buttons, inputs, menus, dropdowns |
| `--lk-radius-row` | 6 | hover row inside a menu / list |
| `--lk-radius-pill` | 999 | chips, badges, status marks |

A box inside a box has a radius no bigger than its parent. Single-sided borders (a left accent bar) get no radius.

## 4. Type, spacing, surfaces
- Font: the system UI stack (`--font-text`); sizes from Obsidian's scale: 12 / 13 / 15 / 20 px (`--font-ui-*`). Body 16 px, line height 1.5.
- Card: fill = 5 % of the text colour mixed into the page colour; border = 22 %; row dividers = 14 %. Padding 14 × 18 px, gap 8 px, grid gap 12 px. Card title 600 weight, 1.05 em; goal / hint text muted 0.92 em.
- Badge: pill, 20 px high, 0.78 em, weight 500, 8 px side padding, tint 0.22.
- Chip: pill, 3 × 10 px padding, 13 px; empty = dashed grey border and muted text, set = accent border and accent text.
- Button: 10 px radius, 6 × 14 px, 13 px; primary = accent fill, white text. Inputs 10 px radius, accent border on focus.
- Dark and light must both work: no hard-coded colours in your own CSS, only the variables.

## 5. Use from Python (plain HTML)
```python
from pathlib import Path
css = Path("lab-kit-dashboard.css").read_text()
STATUS = {"Active": "lk-active", "Started": "lk-started", "Planned": "lk-planned", "Overdue": "lk-overdue"}

def card(title, status, goal, items):
    rows = "".join(f"<li>{i}</li>" for i in items)
    return (f'<div class="lk-card"><div class="lk-card-head"><span class="lk-card-title">{title}</span>'
            f'<span class="lk-badge {STATUS.get(status, "")}">{status}</span></div>'
            f'<div class="lk-card-goal">{goal}</div><ul>{rows}</ul></div>')

html = f'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>{css}</style>' \
       f'<body class="lk"><div class="lk-page"><h1>Dashboard</h1><div class="lk-grid">{card("Project A", "Active", "Goal text", ["Row one", "Row two"])}</div></div></body>'
Path("dashboard.html").write_text(html)
```
Theme switch: set `data-theme="dark"` or `"light"` on `<html>`; with none, it follows the OS.

Streamlit / Dash / NiceGUI: inject the CSS once (`st.markdown(f"<style>{css}</style>", unsafe_allow_html=True)`, `app.index_string`, `ui.add_css`), put `lk` on a wrapping element, and emit the `lk-*` classes for cards, badges and chips. The framework's own widgets keep their look unless you restyle them with the selectors under `.lk input / .lk button`.

## 6. Checklist for a new dashboard element
1. Does a class here already do it? Use it.
2. Colour = a meaning from section 2, not a taste.
3. Radius = one of the four variables.
4. Looks right in light and dark, and at 375 px wide.
5. Public repo: no real names, initials or paths in sample data.
