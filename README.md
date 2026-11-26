# CFO System

A double-entry accounting system that runs in your browser, offline, with nothing to install.

## How to open it
- **Online / install as an app:** https://norazamkamisan.github.io/cfo-system/
  - **PC:** open the link in Edge or Chrome and click the **Install** icon in the address bar (or avatar menu → Install app).
  - **Android:** Chrome → ⋮ → **Add to Home screen**. **iPhone:** Safari → Share → **Add to Home Screen**.
  - Once installed, it works offline.
- **Offline on this PC:** double-click `Start CFO.cmd`, or run `node server.js` and open http://localhost:5173

## Sync between PC and phone
**Control Panel → Sync (PC & phone)** keeps the same books on every device.

**Google Drive · automatic (recommended):** a small helper (`helper/Code.gs`, Google Apps Script) runs in your own
Google account and saves the books to the **CFO System** folder in your Drive, encrypted with your passphrase, with a
daily backup in **CFO System › Backups** (last 30 kept). No sign-in pop-ups — PC and phone sync in the background.
1. On the PC Sync page: **Copy helper code** → script.google.com → New project → paste → **Deploy → Web app**
   (Execute as: Me, Who has access: Anyone) → authorize → copy the Web app URL → paste it in the app → **Connect** →
   **Upload this company**.
2. Still on the PC: **Copy connection code for your phone** and send it to your phone.
3. On the phone: paste the code, enter the same passphrase → **Connect** → **Link & download**.

**Google Drive · sign-in:** direct Drive access with a Google Client ID (`js/config.js`); needs one tap on the sync
icon about once an hour.

**GitHub (alternative):** a private repository (`cfo-data`) with a fine-grained token
(*Contents: Read and write*). Choose the GitHub tab on the Sync page.

Each device still works offline; changes merge automatically after you save, when the app opens, and every
2 minutes. If the same field is changed on both devices before they sync, the device that syncs last keeps
its version and the clash is listed on the Sync page.

## Claims (receipts → approval → books)
Put receipts (photo or PDF) in **Google Drive › CFO System › Claims › _company name_**, or tap **📷 Add receipt** on the
**Claims** page (handy on the phone). While the app is open it checks the folder about every 2 minutes, reads each
receipt with A.I Scan and lists it under **Waiting for approval**. **Nothing is posted until you approve it.**
On approval you choose how it's posted:
- **Expense claim:** you paid. Creates a Bill owed to the claimant, which you settle later with Purchases → Payment.
- **Paid by the company:** creates a Withdrawal from the chosen bank or cash account.
- **Supplier bill:** not paid yet. Creates a Bill owed to the merchant.

Receipts move in Drive from the inbox to **Scanned**, then to **Approved** or **Rejected**. Claims sync to every device
like the rest of the books. Requires the *Google Drive · automatic* helper, version 2 (update it from the Sync page).

**Reading receipts:** with an Anthropic API key (Integrated Apps), A.I reads everything, including line items. Without a
key, or if A.I fails, the app uses **free text recognition** in the browser (Tesseract.js for photos and scanned PDFs,
pdf.js for PDFs with text). It fills in the merchant, date, receipt no., tax and total only, so check each field. The engine
downloads once on first use, so you need to be online the first time. The same fallback is used on the A.I Scan page
(**🔍 Read text (free)**).

## Publishing updates
After changing files: `git add -A`, `git commit -m "…"`, `git push`. GitHub Pages republishes in about a minute,
and installed apps pick up the new version the next time they're opened online.

## Menu
| Menu | What's inside |
|---|---|
| **Dashboard** | *Workflows* tab (flow diagrams) and *Dashboard* tab (cash, receivables, payables, profit, SST, charts, alerts) |
| **Sales** | Sales List · Quote → Sale Order → Invoice · Credit Note · Debit Note · Payment · Refund |
| **Purchases** | Purchases List · Purchase Order → Receive Item → Bill (self-billed option) · Credit Note · Debit Note · Payment · Refund |
| **Transactions** | Per-bank transaction list · Deposit · Withdrawal · Transfer · Journal · Bank accounts |
| **Products & Services** | Products list · Adjustments · Build / Unbuild (assemblies) · Count Inventory · Move Items (locations) · Stock Alert |
| **Contacts** | Contacts (Business / Individual) · Employees · Request contact details (email draft) · Sync (CSV import/export) |
| **Reports** | Ageing (AR/AP summary & details) · Bank reconciliation · Account Transactions · Balance Sheet & P&L (standard + multi-period) · Trial Balance · Cash Flow · General Ledger · Journal Entry · Customer/Supplier Ledger · 10 inventory reports · Job reports · SST Details/Summary · Budget vs Actual · Audit Trail |
| **SST Filing** | Prepare and save SST-02 returns, mark them filed, and post the payment |
| **Control Panel** | Taxes, Tariff Codes, Currencies, Job Tagging, Payment Methods/Terms, Price Levels · Business Profile/Setting, Form Design, Form Settings · Chart of Accounts, Opening Balance, Budgets, Bank Reconciliation · UOM, Locations, Inventory Settings · Integrated Apps · Backup |
| **A.I Scan** | Upload a receipt or supplier invoice (photo or PDF) and turn it into a Bill, Supplier Credit Note or Withdrawal |
| **User menu** | My Profile, Change Password (app lock), My Transactions, Switch Company, Change Language (English / Malay / 中文简体 / 中文繁體), Logout |

## Accounting notes
- Every document posts to the General Ledger automatically. You can see the entries at the bottom of each document.
- Inventory uses a perpetual moving average. Sales post the cost of goods sold, and Receive Item posts to Goods Received Not Invoiced until the bill arrives.
- Foreign currency documents are converted at the rate on the document. Exchange gains and losses on payments are not calculated.

## Your data
- Data is stored in this browser, separately for each company. Use **Control Panel → Backup & Data → Export** regularly.
- The password is a privacy lock for this computer. It does not encrypt your data.
- A.I Scan needs your own Anthropic API key, set in **Control Panel → Integrated Apps**. Each scan sends the image to Anthropic and is billed to that key. The key is saved in the browser and is included in backups.
