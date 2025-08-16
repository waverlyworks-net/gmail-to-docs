Gmail To Docs
============
Consolidate selected Gmail messages into **one continuously updated Google Doc** (newest-first) using Google Apps Script (GAS).

This project is a **fork** of [PixelCog’s *Gmail To PDF*](https://github.com/pixelcog/gmail-to-pdf) and adapts it for a **Google Docs** workflow while keeping the useful internals (message rendering, Drive helpers). The goal is reliability, low maintenance, and “set-it-and-forget-it” automation.

> If you prefer PDFs, the original project remains an excellent option. This fork focuses on a single editable Doc that updates as new emails arrive.

---

## What’s new in this fork

* **Google Docs output mode**: prepend new emails to the top of a single Doc.
* **Batch insertion** (`prependBatchPlain`) for **fewer Drive ops** and faster runs.
* **V8 runtime** via `appsscript.json` (`"runtimeVersion": "V8"`).
* **Dedup ring buffer** of recent Gmail message IDs to avoid accidental repeats.
* **Robust doc recreation** (`ensureConsolidatedDoc_`) if the Doc is deleted or trashed.
* **Reset helpers**:

  * `gtd_resetForReimport()` — reimport from scratch (timestamp + dedup reset).
  * (Optional) `gtd_factoryReset()` / `gtd_recreateDoc()` if you add them.
* **Optional HTML mode** (`OUTPUT_MODE = 'doc_html'`) using Advanced Drive Service
  (`Drive.Files.insert(..., {convert:true})`) for higher-fidelity HTML→Doc conversion.

---

## Files & layout

* `appsscript.json` — GAS manifest (V8 runtime, timezone, logging).
* `docs_mode.gs` — **orchestrator**:

  * `gtd_init()` — seed state + ensure consolidated Doc exists.
  * `processMessagesToDoc()` — scan labeled mail, batch-insert into Doc, persist state.
  * `gtd_resetForReimport()` — reset timestamp & dedup ring.
* `docs_utils.gs` — **helpers**:

  * `prependBatchPlain(messages, docId)` — batch prepend (plain text).
  * `prependMessageToDocPlain(...)` — per-message (plain text).
  * `prependMessageHtmlToDoc(...)` + `convertHtmlToDoc(...)` — optional HTML path.
  * `ensureConsolidatedDoc_()` — recreate Doc if missing/trashed.
* `GmailUtils.gs`, `DriveUtils.gs` — utilities inherited from PixelCog (with minor fixes).
* `docs/GOOGLE_DOCS_MODE.md` — quick notes for Doc mode.

---

## Quick start (from scratch)

### 0) Prereqs

* Node.js and `clasp`:

  ```bash
  brew install node
  npm install -g @google/clasp
  ```
* A Gmail label to target (e.g., `CONSOLIDATE_TO_DOC`) and some test emails with that label.

### 1) Create (or link) an Apps Script project

* **Create a new GAS project** and push files:

  ```bash
  clasp create --title "gmail-to-docs" --type standalone
  # Ensure .clasp.json has: { "scriptId": "...", "rootDir": "." }
  clasp push
  ```
* **…or link an existing one**:

  ```bash
  clasp clone <YOUR_SCRIPT_ID>
  clasp push
  ```

### 2) Configure

In `docs_mode.gs`:

```javascript
const CONSOLIDATE_LABEL = 'CONSOLIDATE_TO_DOC'; // set this to your Gmail label
const OUTPUT_MODE = 'doc_plain';                // start with plain mode (robust)
```

(HTML mode is available as `'doc_html'`, see below.)

Optional: set your timezone in `appsscript.json`:

```json
{
  "timeZone": "America/Chicago",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
```

### 3) First run (authorization)

Open the project in the browser:

```bash
clasp open-script
```

In the editor:

1. Run `gtd_init()` → authorizes & creates `gtd_consolidated_doc` if needed.
2. Label a couple of test emails with `CONSOLIDATE_LABEL`.
3. Run `processMessagesToDoc()` → the Doc should fill with your emails (newest-first).

### 4) Automate it

Set a time-driven trigger in the editor:

* Triggers (clock icon) → **Add trigger** → `processMessagesToDoc` → every 10 minutes
  (or your preferred cadence).

---

## How it works (concise)

* `processMessagesToDoc()` searches `label:CONSOLIDATE_LABEL` (up to `MAX_MESSAGES_PER_RUN` threads).
* It collects messages with `message.date > lastISO` **and** not in the dedup ring buffer.
* For **plain mode**, it builds a **single temporary Doc** containing all new messages (newest-first), then prepends that batch to the consolidated Doc in one step.
* It updates:

  * `gtd_last_iso` (latest processed message date),
  * `gtd_recent_ids` (ring buffer for duplicates),
  * `gtd_consolidated_doc_id` (Doc id).

---

## HTML mode (optional)

If you need formatting closer to the original email:

1. In the Apps Script editor, enable **Advanced Drive Service** (Services → *Drive API*).
2. Set `const OUTPUT_MODE = 'doc_html'` in `docs_mode.gs`.
3. The script will:

   * Wrap metadata + `msg.getBody()` HTML,
   * Convert HTML → Google Doc via `Drive.Files.insert(..., { convert: true })`,
   * Copy content into your consolidated Doc (per-message path).

**Notes:** HTML fidelity varies. Inline `cid:` images may need extra handling (fetch attachment blobs by `Content-ID` and insert via `appendImage()`).

---

## Operations & maintenance

### Reset / reimport

If you want to reimport everything with your label (e.g., after deleting the Doc):

```javascript
function gtd_resetForReimport() {
  const p = PropertiesService.getScriptProperties();
  p.setProperty(PROP_LAST_ISO, '1970-01-01T00:00:00Z');
  p.deleteProperty(PROP_RECENT_IDS);
  Logger.log('Reset done. Run processMessagesToDoc() next.');
}
```

### Robust doc creation

`ensureConsolidatedDoc_()` recreates the Doc if deleted/trashed (called by `gtd_init()` and `processMessagesToDoc()`).

### Throughput & costs

* `MAX_MESSAGES_PER_RUN` defaults to 200. Increase temporarily for backfills.
* Batch insert (plain mode) reduces Drive operations and quota usage.

### Rotation (optional)

Large Docs can slow down. You can add a size guard and rotate monthly:

* When the Doc length exceeds a threshold, create `gtd_consolidated_doc_YYYY-MM`,
  update the property, and continue.

---

## Troubleshooting

* **Doc is empty after `gtd_init()`**
  That’s expected; `gtd_init()` only creates/records the Doc. Run `processMessagesToDoc()` with labeled emails.

* **“No new messages to process.”**
  Check that your label matches `CONSOLIDATE_LABEL` exactly and that your messages are newer than `gtd_last_iso`. Use `gtd_resetForReimport()` to reimport from the beginning.

* **Duplicates**
  The dedup ring stores recent message IDs. If you manually edit state, clear `gtd_recent_ids`.

* **Deleted Doc**
  `ensureConsolidatedDoc_()` will create a new one automatically on the next run.

* **HTML mode errors**
  Ensure Advanced Drive Service is enabled. For inline images, add logic to resolve `cid:` attachments to blobs and insert with `appendImage()`.

* **Editing in the web UI but code is local**
  Use `clasp pull` to sync remote changes down to your repo before committing.

---

## Development tips

* **Sync from GAS (web UI) → local repo**

  ```bash
  git add -A && git commit -m "WIP before pull"
  clasp pull --force
  git add -A
  git commit -m "Sync from GAS (clasp pull)"
  ```

* **Ignore local-only files**

  ```
  .clasp.json
  node_modules/
  .vscode/
  ```

* **Logs**
  `processMessagesToDoc()` logs label, mode, counts, sample subjects, and elapsed time (see code).

---

## Attribution & license

This project is a fork of **[pixelcog/gmail-to-pdf](https://github.com/pixelcog/gmail-to-pdf)** by **PixelCog Inc.** and owes much to its `GmailUtils` and `DriveUtils` design.
Original license and attribution are preserved under **MIT**.

```
The MIT License (MIT)

Copyright (c) 2015 PixelCog Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
[... full MIT text retained as in original ...]
```

Additional modifications in this fork are also provided under the MIT License.
See commit history for authorship of changes.

---

## Roadmap (short)

* Inline `cid:` image embedding for Doc mode.
* Attachment handling: save to Drive folder + link under each email.
* Optional monthly rotation & TOC Doc.
* Tests/smoke scripts and CI lint.

---

If you want the README trimmed for brevity (e.g., GitHub front page), say which sections to keep and I’ll produce a shorter variant.
