# Google Docs Output Mode (gmail-to-docs)

This fork adds a Google Docs output path that **prepends** new emails (newest-first) into a **single consolidated Google Doc**.

## Quick Start

1. In Gmail, create a label (e.g., `CONSOLIDATE_TO_DOC`) and apply it to the messages you want consolidated.
2. Open the Apps Script project and ensure the manifest uses V8 runtime:
   - `appsscript.json` includes `"runtimeVersion": "V8"`.
3. Add the files `docs_mode.gs` and `docs_utils.gs` to your project.
4. In `docs_mode.gs`, set:
   - `CONSOLIDATE_LABEL` to your label (e.g., `CONSOLIDATE_TO_DOC`)
   - `OUTPUT_MODE` to `'doc_plain'` (recommended first) or `'doc_html'` (requires Drive Advanced Service).
5. Run `gtd_init()` once (optional) and then `processMessagesToDoc()` to authorize and process initial messages.
6. Set a time-driven trigger to run `processMessagesToDoc()` on a schedule (e.g., every 10 minutes).

State is stored in Script Properties:
- `gtd_last_iso` — ISO datetime of the last processed message.
- `gtd_consolidated_doc_id` — doc id of the consolidated Google Doc.

## Modes

- `doc_plain`: converts messages to plain text with simple metadata; very robust.
- `doc_html`: attempts HTML → Google Doc conversion via Drive API. Turn on **Advanced Drive Service** in the Apps Script editor (Services → Drive API). Better formatting for some emails, but HTML/CSS fidelity varies, and inline `cid:` images may need custom handling.

## Notes / Next Steps

- For very long Docs (size limits), create monthly archives and rotate `gtd_consolidated_doc_id`.
- Inline images and attachments are not fully handled yet in this first patch. Future work:
  - Embed inline images by fetching attachments that match `Content-ID` and inserting them as images in the Doc.
  - Save non-image attachments to a Drive folder and insert links in the consolidated Doc.
  - Add a guard to skip re-processing already-added messages by tracking message IDs.

## Troubleshooting

- If you see "Service not found: Drive", enable **Advanced Drive Service** (Services → Add a service → Drive API).
- If nothing is added to the doc, confirm your label name matches `CONSOLIDATE_LABEL` and there are labeled messages **newer than** `gtd_last_iso`. You can reset by setting `gtd_last_iso` to `1970-01-01T00:00:00Z` in Script Properties.
- Logs are in **Executions** in the Apps Script editor (or `Logger.log` output).