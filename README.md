# CFO System

A double-entry accounting system that runs in your browser, offline, with nothing to install.

## How to open it
- **Online / install as an app:** https://norazamkamisan.github.io/cfo-system/
  - **PC:** open the link in Edge or Chrome and click the **Install** icon in the address bar (or avatar menu → Install app).
  - **Android:** Chrome → ⋮ → **Add to Home screen**. **iPhone:** Safari → Share → **Add to Home Screen**.
  - Once installed, it works offline.
- **Offline on this PC:** double-click `Start CFO.cmd`, or run `node server.js` and open http://localhost:5173

## Sync between PC and phone
**Control Panel → Sync (PC & phone)** keeps the same books on every device through a **private** GitHub
repository (`cfo-data`), encrypted with your passphrase.
1. Create a fine-grained GitHub token (repository: `cfo-data`, permission *Contents: Read and write*).
2. On the PC: enter the repository, token and a passphrase → **Test & save** → **Upload this company**.
3. On the phone: enter the same three → **Test & save** → **Link & download**.

Each device still works offline; changes merge automatically after you save, when the app opens, and every
2 minutes. If the same field is changed on both devices before they sync, the device that syncs last keeps
its version and the clash is listed on the Sync page.

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
