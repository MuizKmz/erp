# Seed data (Configuration)

The organisation, users, roles and sign-in settings the Configuration module maintains (CLAUDE.md → *Phase 4 · Configuration*). Configuration adds **no new people**: it takes over the 14 users and 2 branches that `SEED_DATA.md` (Purchase) and `SALES_SEED_DATA.md` (Sales) already load, and the roles that Purchase, Sales and Core grant in code today. New are the company, the Auditor role, the permission catalogue and the sign-in settings. "Today" is the same: **29 Sep 2026**.

Purchase, Sales and Core keep working the same: they read users and branches through `MasterDataPort` and check permissions with `@RequirePermission()`. The mockups are `docs/design/mockups/Cfg*.html`; after seeding, the Configuration screens must show the numbers below.

## Company (A04): 1

| Field | Value |
|---|---|
| Code | CLB (the tenant `sys_tenant` CLB · CLB Groups keeps its code) |
| Legal name | CLB Groups Sdn Bhd |
| Registration no (SSM) | 202001012345 (1356789-K) · *demo* |
| TIN | C20881230010 · *demo* |
| Sales tax no | B16-1808-32000001 · *demo* |
| Service tax no | B16-1808-32000002 · *demo* |
| MyInvois taxpayer name | CLB GROUPS SDN BHD |
| Address | Lot 12, Jalan Perusahaan 3, Seksyen 15, 40200 Shah Alam, Selangor |
| Phone · email | +60 3-5510 2200 · accounts@clbgroups.my |
| Base currency · time zone | MYR · Asia/Kuala_Lumpur (read only: currencies come with Finance) |

The values marked *demo* are invented. The Configuration home flags them under *Needs attention* until they are replaced.

## Branches (A05): 2, both directly under the company

| Code | Name | Under | Document prefix | Users | Warehouses | MyInvois branch name |
|---|---|---|---|---|---|---|
| HQ | HQ Shah Alam | — (top level) | HQ | 12 | HQ-DMG, HQ-MAIN | HQ SHAH ALAM |
| PNG | Penang Branch | — (top level) | PNG | 9 | PNG-MAIN | PENANG BRANCH |

- HQ address and phone as the company; email hq@clbgroups.my.
- PNG: No. 8, Lorong Perusahaan Maju 5, 13600 Prai, Pulau Pinang · +60 4-507 1180 · penang@clbgroups.my (*demo*).
- *In use* (A05): HQ is on 152 Purchase and Sales documents (40 open), PNG on 44 (12 open). Neither can be made inactive: Aina Rahman, Hafiz, Nurul, Siti and Siti Counter 1 work only in HQ; Lim Wei Jie and Tan Wei Ling only in PNG.
- A second company can be added with *Add company* on A04 (choice 2). A branch moves to another company only while no document carries it.

## Users (A06, A07): 14, all active

| Code | Name | Email | Roles | Branches (default first) | Two-factor |
|---|---|---|---|---|---|
| ADM | Admin | admin@warehouse.com | Administrator, Master Data Admin | HQ, PNG | Required · not set up |
| AZ | Ahmad Zaki | zaki@warehouse.com | Purchasing Manager | HQ, PNG | Not required |
| AR | Aina Rahman | aina@warehouse.com | Sales agent, Billing, Sales store | HQ | Not required |
| FO | Faizal Omar | faizal@warehouse.com | Sales agent, Billing | HQ, PNG | Not required |
| HAF | Hafiz | hafiz@warehouse.com | Requester, Store | HQ | Not required |
| LMY | Lim Mei Ying | meiying@warehouse.com | Buyer, AP clerk | HQ, PNG | Not required |
| LWJ | Lim Wei Jie | weijie@warehouse.com | Sales agent, Billing | PNG | Not required |
| NA | Nor Azlina | azlina@warehouse.com | Sales Manager | HQ, PNG | Not required |
| NUR | Nurul | nurul@warehouse.com | Requester | HQ | Not required |
| RAH | Rahim | rahim@warehouse.com | Store, Requester, Sales store | HQ, PNG | Not required |
| RI | Rosnah Ismail | rosnah@warehouse.com | Finance Director, Finance Manager | HQ, PNG | Required · not set up |
| SIT | Siti | siti@warehouse.com | Requester | HQ | Not required |
| SC1 | Siti Counter 1 | counter1@warehouse.com | Counter staff | HQ | Not required |
| TWL | Tan Wei Ling | weiling@warehouse.com | Branch Manager | PNG | Not required |

- No role assignment has an end date. Nobody has signed in, so *Last sign-in* is *Never* and the security log is empty.
- **Demo password** (only with `AUTH_MODE=jwt`): every seeded user signs in with **`Zora-demo-2026`**. ADM and RI are then asked to set up two-factor. With `AUTH_MODE=dev` nobody needs a password: the user switcher stays, as today.

## Roles (A08, A09): 16 starter roles

Each module's grants in code today (`purchase.permissions.ts`, `sales.permissions.ts`, `core.permissions.ts`) become the starter roles, plus Administrator and the new Auditor.

| Code | Name | Users | Permissions | Sees | Two-factor |
|---|---|---|---|---|---|
| ADMIN | Administrator | 1 (ADM) | all 54 | Their branches | Required |
| AP_CLERK | AP clerk | 1 (LMY) | 4 | Their branches | — |
| AUDITOR | Auditor | 0 | 6 | Their branches | — |
| SALES_BILLING | Billing | 3 (AR, FO, LWJ) | 6 | Their branches | — |
| BRANCH_MANAGER | Branch Manager | 1 (TWL) | 2 | Their branches | — |
| PURCHASE_BUYER | Buyer | 1 (LMY) | 16 | Their branches | — |
| COUNTER_STAFF | Counter staff | 1 (SC1) | 3 | Their branches | — |
| FINANCE_DIRECTOR | Finance Director | 1 (RI) | 2 | Their branches | Required |
| FINANCE_MANAGER | Finance Manager | 1 (RI) | 3 | Their branches | Required |
| MASTER_DATA_ADMIN | Master Data Admin | 1 (ADM) | 11 | Their branches | Required |
| PURCHASE_MANAGER | Purchasing Manager | 1 (AZ) | 13 | Their branches | — |
| REQUESTER | Requester | 4 (HAF, NUR, RAH, SIT) | 4 | Their branches | — |
| SALES_AGENT | Sales agent | 3 (AR, FO, LWJ) | 9 | **Own customers only** | — |
| SALES_MANAGER | Sales Manager | 1 (NA) | 10 | Their branches | — |
| SALES_STORE | Sales store | 2 (AR, RAH) | 5 | Their branches | — |
| STORE | Store | 2 (HAF, RAH) | 7 | Their branches | — |

- **Auditor:** `config.view`, `config.security.view`, `config.audit.view`, `purchase.view`, `sales.view`, `core.view`. Nobody holds it yet; the home flags that.
- **Administrator** holds every permission, as `ADMIN` does today, without any permission rows. It cannot be edited or deleted.
- Roles are listed by name, ignoring capitals (Administrator before AP clerk), as the database sorts them. The A08 mockup sorted with capitals first.

## Permission catalogue (A09, A10): 54

Each module declares its own permissions, with a label per object and action (SRS FR-SEC-010).

| Module | Permissions | Keys |
|---|---|---|
| Purchase | 17 | `purchase.view`, `purchase.request.create`, `purchase.request.process`, `purchase.rfq.manage`, `purchase.order.edit`, `purchase.order.release`, `purchase.receipt.edit`, `purchase.receipt.confirm`, `purchase.invoice.edit`, `purchase.cancel_order.edit`, `purchase.cancel_order.release`, `purchase.cash_purchase.edit`, `purchase.cash_purchase.release`, `purchase.debit_note.edit`, `purchase.return.edit`, `purchase.return.release`, `purchase.settings.manage` |
| Sales | 19 | as in CLAUDE.md → *Phase 2 · Roles and permissions* |
| Core | 11 | as in CLAUDE.md → *Phase 3 · Roles and permissions* |
| Configuration | 7 | `config.view`, `config.organisation.edit` (company and branches), `config.user.edit`, `config.role.edit`, `config.settings.manage` (sign-in settings), `config.security.view` (security log), `config.audit.view` (audit trail) |

## Sign-in settings (A14)

| Setting | Value | Source |
|---|---|---|
| Shortest password | 10 characters | SRS FR-SEC-060, SDD 10.2 |
| Common passwords | Refused (a local list) | SDD 10.2 |
| Ask to change regularly | Never | SDD 10.2 (no forced rotation) |
| Lock after | 5 wrong passwords, for 15 minutes, counted per account and per network address | SRS FR-SEC-062, SDD 10.2 |
| Sign out after no activity | 30 minutes | SRS FR-SEC-065 |
| A device stays signed in | 30 days (rotating refresh token) | SDD 10.2 |
| Access token | 15 minutes | SDD 10.2 |
| Reset and set-password links last | 60 minutes, single use | SRS FR-SEC-063 |
| Two-factor required for | Administrator, Master Data Admin, Finance Director, Finance Manager | SRS FR-SEC-061 (choice 9) |
| Email a set-password link to new users | On (written to `sys_email_log`) | SRS FR-SEC-064 (choice 10) |

## Data scopes (A7)

| Scope | Who it limits in the seed | What they no longer see |
|---|---|---|
| Branch (documents, by their branch) | HQ only: AR, HAF, NUR, SIT, SC1 · PNG only: LWJ, TWL | Documents of the other branch, through lists, records, look-ups, reports and exports (SRS FR-SEC-022, 032) |
| Branch (customers, by their branch) | Same users | Customers of the other branch, unless the customer is *visible to all branches* (FR-SEC-033; none in the seed) |
| Sales agent (role Sales agent) | AR: C-0012, C-0102 · FO: C-0045, C-0056, C-0078 · LWJ: C-0031 | Other agents' customers and their sales documents (FR-SEC-030, 031) |

Suppliers, items, price lists, tax codes and warehouses are shared master data and are not scoped. A record outside a user's scope answers **404**, never 403 (SDD 10.3.1). Event listeners and the seed run as the *system* and are not scoped; each such action is logged (SDD 10.1).

The journeys in the Purchase, Sales and Core handbooks are re-run in A7. A step where an agent opens another agent's customer moves to the right agent. Today that is Core journey E step 5, where Aina opens C-0045 (Faizal's customer).

## Decided by the SRS and SDD

Checked against `docs/requirements/ERP_SRS.md` (§5, §6.1, §13.4, §13.5) and `ERP_SDD.md` (§7.5, §8.2, §10, ADR-05, ADR-19). These are rules, not choices.

| Topic | Rule | Source |
|---|---|---|
| Company and branch | A legal entity is separate from the places it works from; branches form a tree, and reports roll a parent up with its children. | SRS FR-PLT-001, 004, FR-SEC-025; SDD ADR-19, 8.2 |
| Roles | Any number of roles, edited without code; a user holds several and gets the sum; role templates are data; assignments can expire; every change is audited. | SRS FR-SEC-001 to 007, 014 |
| Permissions | Each module declares its catalogue; every operation is bound to exactly one permission, checked on the server; the UI hides what a user cannot do. | SRS FR-SEC-008, 010 to 013; SDD 10.3, 10.4 |
| Branches per user | A set of branches and one active branch, switchable without signing out; documents are stamped with it; a user with no branch cannot transact. | SRS FR-SEC-020, 021, 024 |
| Sign-in | Email or user name and password; argon2id; lockout per account and address; every attempt recorded; short access token with rotating refresh and reuse detection; sessions listed and revocable; reset by single-use timed link. | SRS FR-SEC-060, 062, 063, 065; NFR-SEC-003, 008; SDD 10.2 |
| Two-factor | TOTP, enforceable per role, mandatory for admin and finance authority. | SRS FR-SEC-061, NFR-SEC-009; SDD 10.2 |
| Data scopes | Branch and sales-agent scopes applied in the data-access layer, on every route; out of scope answers 404. | SRS FR-SEC-020 to 033, NFR-SEC-006; SDD 10.3.1 |
| Audit | Every change with actor, time, before and after, and a correlation id per request; append-only; a read-only audit role. Security events logged apart and kept a year. | SRS FR-PLT-016, 017, FR-SEC-015, NFR-AUD-001, 002, NFR-SEC-012 |
| Tenancy | Tenant id on every table from the first migration; topology decided later. | SDD ADR-05 (already followed) |

## Choices made

Not covered by the SRS or SDD, or settled by the user on 14 Oct 2026. The user approves these with the A0 review.

| # | Where | Question | Choice |
|---|---|---|---|
| 1 | All | Colour of the new module. | Slate, like its launcher tile (`--tile-config #5B6170`). Tokens in `DESIGN_TOKENS.md`. |
| 2 | A04, A05 | One company or two? | One company, CLB Groups Sdn Bhd, with HQ and Penang as its branches (user, 14 Oct). A second company can be added on the screen. |
| 3 | A1 | Where users and branches live. | They move from `mdm_user` and `mdm_branch` to Configuration's own `sys_` tables. `MasterDataPort.listUsers`, `findUser` and `listBranches` keep their answers, so Purchase and Sales do not change. |
| 4 | A09 | Permission key format: the SRS keeps the legacy `Module::Object@Action` (FR-SEC-009). | Keep our `module.object.action` keys (CLAUDE.md wins). A mapping from legacy keys comes with data migration. |
| 5 | A08 | What the starter roles are. | Today's grants in code, unchanged, so every user can do exactly what they can today. *Reset to starter* brings a changed role back. |
| 6 | A08 | Who can change Administrator? | Nobody: it holds every permission and cannot be edited or deleted. At least one active user always keeps it. |
| 7 | A08 | A read-only audit role (FR-SEC-015). | New starter role Auditor: views every module, the security log and the audit trail; changes nothing. |
| 8 | A09 | A user holds Sales agent and Billing. Billing is not agent-scoped: which wins? | The agent scope applies when **any** of the user's roles is agent-scoped. Every seeded agent also holds Billing, so otherwise the scope would never apply. |
| 9 | A14 | Which roles must use two-factor? | Administrator, Master Data Admin, Finance Director, Finance Manager. AP clerk is left out (Lim Mei Ying would otherwise need it for invoice entry). It is a setting. |
| 10 | A07, A14 | How a new user gets a password (FR-SEC-064). | A single-use set-password link by email, never the password itself. Until real email exists, the link is in `sys_email_log`. |
| 11 | A02 | Sign in with email, user code or both? | Both: `aina@warehouse.com` or `AR`. |
| 12 | A03 | Showing the two-factor QR code needs a package to draw it. | Ask with the A0 review: add `qrcode`, or show only the setup key to type into the app. The mockup shows both. |
| 13 | A03 | Recovery when the phone is lost. | 8 single-use recovery codes at setup; the Administrator can reset a user's two-factor (logged). |
| 14 | A01 | The company's TIN and numbers are invented. | Marked *demo* and flagged on the home until replaced. |
| 15 | A12, A13 | Security log and audit trail: one list or two? | Two: the security log holds sign-ins, failures, lockouts, password and two-factor changes and role changes (NFR-SEC-012); the audit trail is every record change in every module (`sys_activity`). Both read only. |
| 16 | A13 | Grouping the changes of one request (FR-PLT-016). | A correlation id is added to `sys_activity`, set by the platform from the request; no module code changes. |
| 17 | A7 | *Visible to all branches* on a customer (FR-SEC-033). | A switch on the Core customer form, off for every seeded customer. It is the only Core change in this phase. |
| 18 | A05 | Branch statutory numbers for payroll (employer, EPF, SOCSO: FR-PLT-002). | Come with payroll. A branch now has its address, contacts, document prefix and MyInvois branch name. |
| 19 | All | Keeping the demo and the tests working. | `AUTH_MODE=dev` keeps the user switcher and `x-dev-user`, as today. `AUTH_MODE=jwt` turns on sign-in and hides the switcher. Data scopes apply in both modes. |
| 20 | A11 | Where *My account* opens. | From the user menu in the top bar of every module. Everyone can open it; the rest of Configuration needs `config.view`. |
| 21 | A5 | Which clock sign-in uses while the demo pins the date (`DEV_TODAY`). | The real clock: sessions, lockouts, attempts and the security log keep real times; only business dates follow `DEV_TODAY`. |
| 22 | A5 | Locking a network address (FR-SEC-062). | As decided: 5 failures (wrong passwords or unknown users) from one address within 15 minutes lock that address for everyone for 15 minutes. People behind one office address share the count; raising it is a setting to add if that bites. |
