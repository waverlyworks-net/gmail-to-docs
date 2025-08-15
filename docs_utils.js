/**
 * docs_utils.gs
 * Helpers for Google-Doc output mode.
 *
 * Contains:
 *  - prependMessageToDocPlain(msg, consolidatedDocId)
 *  - convertHtmlToDoc(htmlString, title)  (requires Advanced Drive service 'Drive')
 *  - prependMessageHtmlToDoc(msg, consolidatedDocId)
 *  - escapeHtml(s)
 *  - copyElementToBody(child, destBody)   (basic element copier)
 */

function prependBatchPlain(messages, consolidatedDocId) {
  const mainDoc  = DocumentApp.openById(consolidatedDocId);
  const mainBody = mainDoc.getBody();
  const tmpDoc   = DocumentApp.create('gtd_tmp_batch_' + Date.now());
  const tmpBody  = tmpDoc.getBody();

  // messages should be newest-first
  for (const { message: msg } of messages) {
    tmpBody.appendParagraph('--- EMAIL START ---').setHeading(DocumentApp.ParagraphHeading.HEADING6);
    tmpBody.appendParagraph('Subject: ' + (msg.getSubject() || '(no subject)'));
    tmpBody.appendParagraph('From: ' + (msg.getFrom() || ''));
    tmpBody.appendParagraph('To: ' + (msg.getTo() || ''));
    tmpBody.appendParagraph('Date: ' + msg.getDate().toString());
    tmpBody.appendParagraph('');
    const plain = (msg.getPlainBody && msg.getPlainBody()) ? msg.getPlainBody()
                 : (msg.getBody && msg.getBody()) ? msg.getBody()
                 : '(no body)';
    plain.split(/\r?\n/).forEach(line => tmpBody.appendParagraph(line));
    tmpBody.appendParagraph('--- EMAIL END ---');
    tmpBody.appendPageBreak();
  }

  // Prepend the whole batch at once by inserting children in reverse
  for (let i = tmpBody.getNumChildren() - 1; i >= 0; i--) {
    const child = tmpBody.getChild(i).copy();
    if (child.getType && child.getType() === DocumentApp.ElementType.PARAGRAPH) {
      mainBody.insertParagraph(0, child.asParagraph().getText());
    } else if (child.getType && child.getType() === DocumentApp.ElementType.LIST_ITEM) {
      mainBody.insertListItem(0, child.asListItem().getText());
    } else if (child.getType && child.getType() === DocumentApp.ElementType.PAGE_BREAK) {
      mainBody.insertPageBreak(0);
    } else {
      mainBody.insertParagraph(0, child.getText ? child.getText() : '[unsupported element]');
    }
  }
  DriveApp.getFileById(tmpDoc.getId()).setTrashed(true);
}

/**
 * Prepend a message into consolidated doc using plain text (very reliable).
 * Newest messages are inserted at the top.
 */
function prependMessageToDocPlain(msg, consolidatedDocId) {
  const mainDoc  = DocumentApp.openById(consolidatedDocId);
  const mainBody = mainDoc.getBody();

  // Build temporary doc for the message content
  const tmpDoc  = DocumentApp.create('gtd_tmp_msg_' + new Date().getTime());
  const tmpBody = tmpDoc.getBody();

  tmpBody.appendParagraph('--- EMAIL START ---').setHeading(DocumentApp.ParagraphHeading.HEADING6);
  tmpBody.appendParagraph('Subject: ' + (msg.getSubject() || '(no subject)'));
  tmpBody.appendParagraph('From: ' + (msg.getFrom() || ''));
  tmpBody.appendParagraph('To: ' + (msg.getTo() || ''));
  tmpBody.appendParagraph('Date: ' + msg.getDate().toString());
  tmpBody.appendParagraph('');

  const plain = (msg.getPlainBody && msg.getPlainBody()) ? msg.getPlainBody()
               : (msg.getBody && msg.getBody()) ? msg.getBody()
               : '(no body)';
  plain.split(/\r?\n/).forEach(line => {
    tmpBody.appendParagraph(line);
  });

  tmpBody.appendParagraph('--- EMAIL END ---');
  tmpBody.appendPageBreak();

  // Insert tmpDoc children into mainDoc at the top (insert in reverse so order is preserved)
  const n = tmpBody.getNumChildren();
  for (let i = n - 1; i >= 0; i--) {
    const child = tmpBody.getChild(i).copy();
    try {
      if (child.getType && child.getType() === DocumentApp.ElementType.PARAGRAPH) {
        mainBody.insertParagraph(0, child.asParagraph().getText());
      } else if (child.getType && child.getType() === DocumentApp.ElementType.LIST_ITEM) {
        mainBody.insertListItem(0, child.asListItem().getText());
      } else if (child.getType && child.getType() === DocumentApp.ElementType.PAGE_BREAK) {
        mainBody.insertPageBreak(0);
      } else {
        // fallback - plain text
        mainBody.insertParagraph(0, child.getText ? child.getText() : '[unsupported element]');
      }
    } catch (err) {
      mainBody.insertParagraph(0, '[insert failed: ' + err.toString() + ']');
    }
  }

  // Remove temporary doc to avoid clutter
  DriveApp.getFileById(tmpDoc.getId()).setTrashed(true);
}

/**
 * Convert HTML string into a Google Doc using Drive API convert.
 * Requires Advanced Drive Service enabled in the Apps Script editor (Services -> Drive API).
 * Returns the new docId.
 */
function convertHtmlToDoc(htmlString, title) {
  const blob = Utilities.newBlob(htmlString, 'text/html', title + '.html');
  const resource = {
    title: title,
    mimeType: 'text/html'
  };
  // Drive.Files.insert converts the uploaded HTML into a Google Doc when convert=true
  const file = Drive.Files.insert(resource, blob, {convert: true});
  return file.id;
}

/**
 * Prepend HTML message into consolidated doc.
 * This converts message HTML->Doc via Drive.Files.insert convert=true,
 * then copies the doc content into the consolidated doc.
 *
 * NOTE:
 *  - This is a pragmatic approach; it won't automatically resolve inline 'cid:' images.
 *  - For better fidelity, add image fetching & data-URI replacement before conversion.
 */
function prependMessageHtmlToDoc(msg, consolidatedDocId) {
  const htmlHeader = `
    <html><head><meta charset="utf-8"></head><body>
    <div><strong>Subject:</strong> ${escapeHtml(msg.getSubject() || '')}</div>
    <div><strong>From:</strong> ${escapeHtml(msg.getFrom() || '')}</div>
    <div><strong>To:</strong> ${escapeHtml(msg.getTo() || '')}</div>
    <div><strong>Date:</strong> ${escapeHtml(msg.getDate().toString())}</div>
    <hr/>`;

  // Prefer the HTML body when present
  const bodyHtml = (msg.getBody && msg.getBody()) ? msg.getBody()
                  : escapeHtml((msg.getPlainBody && msg.getPlainBody()) ? msg.getPlainBody() : '(no body)');

  const fullHtml = htmlHeader + bodyHtml + '</body></html>';

  const tmpDocId = convertHtmlToDoc(fullHtml, 'gtd_tmp_html_' + new Date().getTime());

  // Copy children from tmpDoc to consolidated doc at top
  const tmpDoc  = DocumentApp.openById(tmpDocId);
  const tmpBody = tmpDoc.getBody();
  const mainDoc = DocumentApp.openById(consolidatedDocId);
  const mainBody= mainDoc.getBody();

  for (let i = tmpBody.getNumChildren() - 1; i >= 0; i--) {
    const child = tmpBody.getChild(i).copy();
    try {
      if (child.getType && child.getType() === DocumentApp.ElementType.PARAGRAPH) {
        mainBody.insertParagraph(0, child.asParagraph().getText());
      } else if (child.getType && child.getType() === DocumentApp.ElementType.LIST_ITEM) {
        mainBody.insertListItem(0, child.asListItem().getText());
      } else if (child.getType && child.getType() === DocumentApp.ElementType.TABLE) {
        // basic table flattening
        const table = child.asTable();
        for (let r = table.getNumRows() - 1; r >= 0; r--) {
          const row = table.getRow(r);
          let rowText = [];
          for (let c = 0; c < row.getNumCells(); c++) {
            rowText.push(row.getCell(c).getText());
          }
          mainBody.insertParagraph(0, rowText.join('\t'));
        }
      } else if (child.getType && child.getType() === DocumentApp.ElementType.PAGE_BREAK) {
        mainBody.insertPageBreak(0);
      } else if (child.getType && child.getType() === DocumentApp.ElementType.INLINE_IMAGE) {
        const blob = child.asInlineImage().getBlob();
        mainBody.insertImage(0, blob);
      } else {
        mainBody.insertParagraph(0, child.getText ? child.getText() : '[unsupported element]');
      }
    } catch (e) {
      mainBody.insertParagraph(0, '[insert failed: ' + e.toString() + ']');
    }
  }

  // Trash tmp doc
  DriveApp.getFileById(tmpDocId).setTrashed(true);
}

/* Minimal HTML escape to avoid injecting tags into metadata fields */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * copyElementToBody(child, destBody)
 * A small element copier to support Paragraphs, ListItems, Tables, InlineImage, PageBreak.
 * Not exhaustive but useful later when preserving element types becomes important.
 */
function copyElementToBody(child, destBody) {
  const type = child.getType();
  switch (type) {
    case DocumentApp.ElementType.PARAGRAPH:
      destBody.appendParagraph(child.asParagraph().getText());
      break;
    case DocumentApp.ElementType.LIST_ITEM:
      destBody.appendListItem(child.asListItem().getText());
      break;
    case DocumentApp.ElementType.TABLE:
      const table = child.asTable();
      for (let r = 0; r < table.getNumRows(); r++) {
        const cells = table.getRow(r).getNumCells();
        let rowText = [];
        for (let c = 0; c < cells; c++) {
          rowText.push(table.getRow(r).getCell(c).getText());
        }
        destBody.appendParagraph(rowText.join('\t'));
      }
      break;
    case DocumentApp.ElementType.INLINE_IMAGE:
      try {
        const blob = child.asInlineImage().getBlob();
        destBody.appendImage(blob);
      } catch (e) {
        destBody.appendParagraph('[image error]');
      }
      break;
    case DocumentApp.ElementType.PAGE_BREAK:
      destBody.appendPageBreak();
      break;
    default:
      try {
        destBody.appendParagraph(child.getText ? child.getText() : child.asText().getText());
      } catch (e) {
        destBody.appendParagraph('[unsupported element]');
      }
  }
}