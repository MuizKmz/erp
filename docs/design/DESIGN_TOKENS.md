# Design tokens

Values taken from the mockups. Put them in one place in the frontend (`src/assets/erp-theme.css`) and use them through CSS variables or Tailwind classes. Do not hard-code these hex values inside components.

## Type and shape

| Token | Value |
|---|---|
| Font | `Inter`, fallback `system-ui, sans-serif` (Google Fonts, weights 400 500 600 700 800) |
| Base text | 13px; labels 12px; table headers 11px uppercase, letter-spacing 0.04em |
| Page title | 18px bold on lists, 20px bold on documents |
| Card | white, 1px border `#E4E6EE`, radius 12px |
| Inputs | height 38px, radius 8px, border `#D9DCE6` |
| Buttons | height 36px, radius 8px, 13px semibold |
| Page background | `#F3F4F8` |
| Text | primary `#1E2233`, muted `#5E6478` |
| Layout | sidebar 220px, top bar 56px, content padding 18px 28px |

## Module themes

Each module has its own sidebar colour so users always know where they are. Set these variables on the module layout root (for example `<div class="erp-module" data-module="purchase">`).

| Variable | Purchase (green) | Sales (purple) | Use |
|---|---|---|---|
| `--mod-side` | `#15803D` | `#7B4FE0` | Sidebar and top bar background |
| `--mod-hover` | `#17733A` | `#6A42D6` | Sidebar item hover |
| `--mod-active` | `#14532D` | `#5B35C9` | Active sidebar item |
| `--mod-pill` | `#166534` | `#6A42D6` | Search box in the top bar |
| `--mod-primary` | `#166534` | `#6D45DB` | The one filled “next step” button (Release, Award, Confirm) |
| `--mod-accent` | `#166534` | `#5B35C9` | Active tab text, badge text |
| `--mod-line` | `#15803D` | `#6D45DB` | Active tab underline, focused cell border |
| `--mod-light` | `#F0FDF4` | `#F8F5FF` | Selected row, info notes |
| `--mod-light-border` | `#BBF7D0` | `#DDD6FE` | Border for info notes |

Launcher uses a neutral grey background `#DFE2E8` with one coloured tile per module.

## Buttons (same in every module)

| Class idea | Colour | When |
|---|---|---|
| Add new | blue `#2563EB`, white text | Starts a new document |
| Primary (module) | `--mod-primary`, white text | The next step. Only one per screen |
| Secondary | white, border `#D9DCE6` | Print, Email, Save draft, Back |
| Danger outline | white, text `#B91C1C`, border `#F3B4B4` | Reject, Cancel balance |
| Delete | red `#DC2626`, white | Delete drafts only |
| Import | dark `#4B5563`, white | Bulk upload |
| Export | green `#15803D`, white | Download as Excel |

## Status chips (same in every module)

| Status group | Background | Text | Examples |
|---|---|---|---|
| draft | `#EEF0F4` | `#475069` | Draft |
| pending | `#FEF3C7` | `#92400E` | Pending approval, To match, Waiting for credit |
| released | `#DBEAFE` | `#1E40AF` | Released, Submitted, Waiting, Sent |
| partial | `#EDE9FE` | `#5B21B6` | Partially received, Short 5, Partial |
| done | `#DCFCE7` | `#166534` | Done, Converted, Awarded, Settled, Approved, Paid |
| cancelled | `#FEE2E2` | `#991B1B` | Rejected, Cancelled, Closed |

Make one `StatusChip` component that maps a document status to these groups. Never colour a status by hand in a page.

## Notes and banners

| Kind | Background | Border | Text | Use |
|---|---|---|---|---|
| Info | `--mod-light` | `--mod-light-border` | `#1E2233` | Policy hints |
| Warning | `#FFFBEB` | `#FCD34D` | `#78350F` | “Inventory is not connected yet…”, soft warnings |
| Error | `#FEF2F2` | `#FECACA` | `#7F1D1D` | Blocked actions, failed checks |

## Numbers and dates

- Money: `RM 4,400.00` in totals and KPIs; `4,400.00` inside tables with the currency in the column header. Always 2 decimals, right-aligned, `font-variant-numeric: tabular-nums`.
- Quantities: whole numbers unless the unit allows decimals; show the unit (`100 ROLL`).
- Dates: `29 Sep 2026`. Date and time: `29 Sep, 10:05 AM`. Timezone `Asia/Kuala_Lumpur`.

## PrimeVue and Tailwind

- Use Tailwind (TailAdmin) for layout, cards, typography and spacing.
- Use PrimeVue 4 for the heavy widgets: DataTable, Select/AutoComplete (Master Data pickers), DatePicker, Dialog, Toast, ConfirmDialog.
- Point the PrimeVue preset’s primary colour at `--mod-primary` so dialogs and focus rings follow the module colour.
- Icons: `lucide-vue-next` (the mockups use the same icon style).
