# EPY Cost Split

A lightweight, offline-first expense splitting single-page application. Create expense groups, log shared costs, assign custom percentage splits, and let the app calculate who owes whom.

## Prerequisites

**The app depends on `/sdcard/storage/cost-split/` folder to store application data. Please create this folder before running the app.**

## Features

### Group Management
- **Create expense groups** with a custom name and currency (USD, GBP, EUR, CNY).
- **Accordion-style UI** — expand a group to view and manage its expenses, collapse to keep things tidy.
- **Mark groups as settled** to lock them from further edits, or delete groups entirely.
- **Import / Export** — download a group as a portable JSON data feed, or restore a previously exported group via drag-and-drop upload.

### Expense Tracking
- **Add expenses** with a description, amount, payer, expense type, and date.
- **Edit or delete** any existing expense inline.
- **Auto-complete inputs** for friends and expense categories — type a new name and it gets saved to your constants for next time.
- **Per-expense member tagging** — explicitly choose which members are involved in each expense rather than relying on a global member list.

### Flexible Cost Splitting
- **Equal split** — costs are divided evenly across all involved members by default, with penny-accurate remainder handling.
- **Custom percentage split** — open the *Split by %* modal to assign specific percentage allocations per member with strict 100% validation.

### Balance & Debt Calculation
- **Net balance tracking** — real-time per-member balance display showing who is owed money and who owes.
- **Greedy debt simplification** — the settlement algorithm minimises the total number of transactions needed to settle all debts.

### Expense Charts
- **Downloadable pie charts** — generate a self-contained JPEG expense breakdown chart (rendered via Canvas) showing per-payer slices, percentage annotations, and net balances. No charting library required.

### Data Persistence
- **localStorage caching** with safe quota handling — constants and group details are cached locally for instant load times.
- **Backend sync** — all data is synced to a remote file-based backend via REST (`GET /system/file`, `POST /system/upload`), making it suitable for deployment on embedded devices like the EPY platform.

---

## Data Format

### Group Feed (JSON)

Each group is stored as a self-contained JSON file with the following schema:

```json
{
  "name": "Summer Trip",
  "creationDate": "2026-04-20T12:00:00.000Z",
  "currency": "GBP",
  "settled": false,
  "friends": ["Alice", "Bob", "Charlie"],
  "expenses": [
    {
      "id": "exp-a1b2c3d",
      "description": "Dinner",
      "amount": 90.00,
      "date": "2026-04-20T00:00:00.000Z",
      "type": "Food",
      "paidBy": { "Alice": 90.00 },
      "splitAmong": { "Alice": 30.00, "Bob": 30.00, "Charlie": 30.00 }
    }
  ]
}
```

You can export this file from any group and re-import it later via the **Upload** modal to restore or transfer data between devices.

---

## License

This project is part of the [EPY](https://github.com/AcierDev/EPY) ecosystem.
