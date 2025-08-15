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
const CONSOLIDATE_LABEL       = 'CONSOLIDATE_TO_DOC'; // <-- change to your Gmail label
const PROP_LAST_ISO           = 'gtd_last_iso';
const PROP_CONSOLIDATED_DOC   = 'gtd_consolidated_doc_id';
const MAX_MESSAGES_PER_RUN    = 200;

/* Choose 'doc_plain' for reliability. Use 'doc_html' for HTML->Doc (requires Advanced Drive Service). */
const OUTPUT_MODE             = 'doc_plain'; // or 'doc_html'

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
  if (!props.getProperty(PROP_CONSOLIDATED_DOC)) {
    const doc = DocumentApp.create('gtd_consolidated_doc');
    props.setProperty(PROP_CONSOLIDATED_DOC, doc.getId());
    Logger.log('Created consolidated doc: %s', doc.getId());
  }
  Logger.log('Initialized. lastISO=%s docId=%s',
             props.getProperty(PROP_LAST_ISO),
             props.getProperty(PROP_CONSOLIDATED_DOC));
}

/**
 * Entry point - schedule this on a time trigger (e.g., every 10 minutes).
 */
function processMessagesToDoc() {
  const props = PropertiesService.getScriptProperties();
  const lastISO = props.getProperty(PROP_LAST_ISO) || '1970-01-01T00:00:00Z';
  let consolidatedDocId = props.getProperty(PROP_CONSOLIDATED_DOC);

  Logger.log('processMessagesToDoc starting. lastISO=%s consolidatedDocId=%s', lastISO, consolidatedDocId);

  // Ensure consolidated doc exists
  if (!consolidatedDocId) {
    const doc = DocumentApp.create('gtd_consolidated_doc');
    consolidatedDocId = doc.getId();
    props.setProperty(PROP_CONSOLIDATED_DOC, consolidatedDocId);
    Logger.log('Created new consolidated doc: %s', consolidatedDocId);
  }

  const lastDate = new Date(lastISO);

  // Find threads with the label
  const query = `label:${CONSOLIDATE_LABEL}`;
  const threads = GmailApp.search(query, 0, MAX_MESSAGES_PER_RUN);

  // Collect messages newer than lastDate
  let newMessages = [];
  for (let i = 0; i < threads.length; i++) {
    const t = threads[i];
    const msgs = t.getMessages();
    for (let j = 0; j < msgs.length; j++) {
      const m = msgs[j];
      const d = m.getDate();
      if (d > lastDate) {
        newMessages.push({date: d, message: m});
      }
    }
  }

  if (newMessages.length === 0) {
    Logger.log('No new messages to process.');
    return;
  }

  // Sort newest -> oldest
  newMessages.sort((a,b) => b.date - a.date);
  Logger.log('Found %s new messages.', newMessages.length);

  let newestSeen = lastDate;

  // Process each new message (newest-first)
  newMessages.forEach(item => {
    const msg = item.message;
    try {
      if (OUTPUT_MODE === 'doc_plain') {
        prependMessageToDocPlain(msg, consolidatedDocId);
      } else if (OUTPUT_MODE === 'doc_html') {
        prependMessageHtmlToDoc(msg, consolidatedDocId);
      } else {
        throw new Error('Unknown OUTPUT_MODE: ' + OUTPUT_MODE);
      }
      if (item.date > newestSeen) newestSeen = item.date;
      Logger.log('Processed message: %s (date=%s)', msg.getSubject(), msg.getDate());
    } catch (e) {
      Logger.log('Error processing message (subject=%s): %s', msg.getSubject(), e.toString());
    }
  });

  // Update state
  props.setProperty(PROP_LAST_ISO, newestSeen.toISOString());
  Logger.log('State updated. new lastISO=%s', newestSeen.toISOString());
}