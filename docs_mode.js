/**
 * docs_mode.gs
 * Orchestrator: incremental processing of Gmail messages and prepending them into
 * a single consolidated Google Doc (newest-first).
 *
 * Behavior:
 *  - Uses a Gmail label (CONSOLIDATE_LABEL) to find candidate threads/messages.
 *  - Keeps state in Script Properties:
 *      PROP_LAST_ISO -> ISO string of last-processed message date
 *      PROP_CONSOLIDATED_DOC -> docId of the consolidated doc
 *  - Newest messages are prepended (appear at top).
 *  - Two output modes supported:
 *      OUTPUT_MODE = 'doc_plain'  -> reliable plain-text conversion
 *      OUTPUT_MODE = 'doc_html'   -> attempt HTML -> Google Doc conversion (requires Drive Advanced Service)
 *
 * NOTE:
 *  - This is intentionally conservative as a first step.
 *  - Attachments and inline images are handled in later iterations.
 */

/* =========================
   Configuration
   ========================= */
const CONSOLIDATE_LABEL       = 'GTD_LABEL'; // <-- change to your Gmail label
const PROP_LAST_ISO           = 'gtd_last_iso';
const PROP_CONSOLIDATED_DOC   = 'gtd_consolidated_doc_id';
const MAX_MESSAGES_PER_RUN    = 200;

/* Choose 'doc_plain' for reliability. Use 'doc_html' for HTML->Doc (requires Advanced Drive Service). */
const OUTPUT_MODE             = 'doc_plain'; // or 'doc_html'

const PROP_RECENT_IDS = 'gtd_recent_ids';
const RECENT_IDS_LIMIT = 200;

function getRecentIds_() {
  const s = PropertiesService.getScriptProperties().getProperty(PROP_RECENT_IDS);
  return s ? new Set(JSON.parse(s)) : new Set();
}
function saveRecentIds_(set) {
  const arr = Array.from(set).slice(-RECENT_IDS_LIMIT);
  PropertiesService.getScriptProperties().setProperty(PROP_RECENT_IDS, JSON.stringify(arr));
}


/**
 * One-time initialization (optional).
 * - Creates the consolidated Doc if missing.
 * - Seeds last-processed timestamp if not present.
 */
function gtd_init() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP_LAST_ISO)) {
    props.setProperty(PROP_LAST_ISO, '1970-01-01T00:00:00Z');
  }
  const id = ensureConsolidatedDoc_();
  Logger.log('Initialized. lastISO=%s docId=%s',
             props.getProperty(PROP_LAST_ISO), id);
}


/**
 * Entry point - schedule this on a time trigger (e.g., every 10 minutes).
 */
function processMessagesToDoc() {
  const t0 = Date.now();
  const props = PropertiesService.getScriptProperties();

  // Config/state
  const lastISO = props.getProperty(PROP_LAST_ISO) || '1970-01-01T00:00:00Z';
  let consolidatedDocId = ensureConsolidatedDoc_();
  const recent = getRecentIds_();
  const lastDate = new Date(lastISO);

  // Logging helpers
  const tz = Session.getScriptTimeZone();
  const fmt = d => Utilities.formatDate(d, tz, "yyyy-MM-dd HH:mm:ss");
  const sampleN = 5;

  Logger.log(
    "processMessagesToDoc(): label=%s | mode=%s | lastISO=%s | docId=%s",
    CONSOLIDATE_LABEL, OUTPUT_MODE, lastISO, consolidatedDocId
  );

  // Gather candidates
  const threads = GmailApp.search(`label:${CONSOLIDATE_LABEL}`, 0, MAX_MESSAGES_PER_RUN);
  let totalMsgsSeen = 0;
  const newMessages = [];

  for (const t of threads) {
    const msgs = t.getMessages();
    totalMsgsSeen += msgs.length;
    for (const m of msgs) {
      if (m.getDate() > lastDate && !recent.has(m.getId())) {
        newMessages.push({ date: m.getDate(), message: m, id: m.getId(), subj: m.getSubject() || "(no subject)" });
      }
    }
  }

  // Sort newest → oldest
  newMessages.sort((a,b) => b.date - a.date);

  // Log discovery
  Logger.log(
    "Scanned: threads=%s | messages=%s | newEligible=%s",
    threads.length, totalMsgsSeen, newMessages.length
  );
  if (newMessages.length) {
    const samples = newMessages.slice(0, sampleN).map(x => x.subj);
    Logger.log("Sample new subjects (up to %s): %s", sampleN, JSON.stringify(samples));
    Logger.log("Newest candidate date=%s | Oldest candidate date=%s",
      fmt(newMessages[0].date), fmt(newMessages[newMessages.length-1].date));
  }

  if (!newMessages.length) {
    Logger.log("No new messages to process. Done in %sms.", Date.now() - t0);
    return;
  }

  // Process
  let newestSeen = lastDate;

  if (OUTPUT_MODE === 'doc_plain') {
    Logger.log("Inserting (plain batch) %s messages into docId=%s ...", newMessages.length, consolidatedDocId);
    prependBatchPlain(newMessages, consolidatedDocId);
    newestSeen = newMessages[0].date;           // newest-first
    for (const it of newMessages) recent.add(it.id);

  } else if (OUTPUT_MODE === 'doc_html') {
    Logger.log("Inserting (HTML per-message) %s messages into docId=%s ...", newMessages.length, consolidatedDocId);
    for (const item of newMessages) {
      const { message: msg, id } = item;
      try {
        prependMessageHtmlToDoc(msg, consolidatedDocId);
        recent.add(id);
        if (item.date > newestSeen) newestSeen = item.date;
      } catch (e) {
        Logger.log('Error processing message (subject=%s): %s', msg.getSubject(), e.toString());
      }
    }
  } else {
    throw new Error('Unknown OUTPUT_MODE: ' + OUTPUT_MODE);
  }

  // Persist state
  props.setProperty(PROP_LAST_ISO, newestSeen.toISOString());
  saveRecentIds_(recent);

  Logger.log(
    "Updated state: lastISO=%s | recentIds=%s | elapsed=%sms",
    newestSeen.toISOString(), recent.size, Date.now() - t0
  );
}


function ensureConsolidatedDoc_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(PROP_CONSOLIDATED_DOC);
  let needsNew = false;
  if (!id) {
    needsNew = true;
  } else {
    try {
      const f = DriveApp.getFileById(id);
      if (!f || f.isTrashed()) needsNew = true;
    } catch (e) {
      // Not found or no access
      needsNew = true;
    }
  }
  if (needsNew) {
    const doc = DocumentApp.create('gtd_consolidated_doc');
    id = doc.getId();
    props.setProperty(PROP_CONSOLIDATED_DOC, id);
    Logger.log('Created new consolidated doc: %s', id);
  }
  return id;
}

function gtd_resetForReimport() {
  const p = PropertiesService.getScriptProperties();
  p.setProperty(PROP_LAST_ISO, '1970-01-01T00:00:00Z'); // reprocess from the beginning
  p.deleteProperty(PROP_RECENT_IDS);                    // clear dedup ring
  Logger.log('Reset done. Run processMessagesToDoc() next.');
}
