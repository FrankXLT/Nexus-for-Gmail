/**
 * Purpose: Executes the core engine pipeline for categorizing emails.
 * Input: None
 * Output: Modifies Gmail threads (labels, stars, importance), reads/writes Drive properties and logs, makes API calls.
 * Importance: This is the primary driver of the application, orchestrating thread fetching, API processing, and result application.
 */
function mainPipeline() {

  const readyLabel = GmailApp.getUserLabelByName(CONFIG.LABEL_READY);
  const completeLabel = getOrCreateLabel(CONFIG.LABEL_COMPLETE);
  const failedLabel = getOrCreateLabel(CONFIG.LABEL_FAILED);
  
  if (!readyLabel) return;
  const rawThreads = readyLabel.getThreads(0, 40); 
  if (rawThreads.length === 0) return;

  // Initialize Drive variables early so we can write to the log if we only have zombie threads
  const props = PropertiesService.getUserProperties();
  const promptDocId = props.getProperty('PROMPT_DOC_ID');
  const logsFolderId = props.getProperty('LOGS_FOLDER_ID');
  let debugFolderId = props.getProperty('DEBUG_FOLDER_ID');
  
  if (!promptDocId || !logsFolderId) {
    Logger.log("Error: System not initialized. Please run installNexus() first.");
    return;
  }
  
  if (CONFIG.DEBUG_MODE && !debugFolderId) {
    const masterFolder = DriveApp.getFolderById(logsFolderId).getParents().next();
    const newDebugFolder = masterFolder.createFolder(CONFIG.DEBUG_FOLDER_NAME);
    debugFolderId = newDebugFolder.getId();
    props.setProperty('DEBUG_FOLDER_ID', debugFolderId);
  }

  // --- QUOTA MANAGEMENT TRACKING ---
  let quotaData = getAndUpdateQuota(props);

  // Initialize the log immediately
  let jobLog = {
    startTime: new Date(),
    apiCalls: 0,
    batches: [],
    quota: quotaData 
  };

  // Special batch just for tracking conflict resolution
  let skippedBatch = {
    domain: "System Cleanup (Ignored Zombie Threads)",
    duration: "0.00",
    tokens: { total: 0, prompt: 0, candidates: 0 },
    emails: []
  };

  // CONFLICT RESOLUTION & TIME WINDOW PRIORITIZATION
  const now = Date.now();
  const freshThreshold = now - (CONFIG.QUOTA_MANAGEMENT.FRESH_WINDOW_HOURS * 60 * 60 * 1000);

  const buckets = {};
  let domainCount = 0;
  let threadsToProcess = 0;

  for (let i = 0; i < rawThreads.length; i++) {
    const labels = rawThreads[i].getLabels();
    const hasComplete = labels.some(l => l.getName() === CONFIG.LABEL_COMPLETE);
    const isTrashedOrSpam = rawThreads[i].isInTrash() || rawThreads[i].isInSpam();
    
    if (hasComplete || isTrashedOrSpam) {
      rawThreads[i].removeLabel(readyLabel);
      const latestMessage = rawThreads[i].getMessages()[rawThreads[i].getMessages().length - 1];
      
      // Add it to our telemetry report
      skippedBatch.emails.push({
        subject: latestMessage.getSubject(),
        snippet: "Thread bypassed by system cleanup protocols.",
        link: rawThreads[i].getPermalink(),
        before: [CONFIG.LABEL_READY, hasComplete ? CONFIG.LABEL_COMPLETE : "Trash/Spam"],
        after: [hasComplete ? CONFIG.LABEL_COMPLETE : "Skipped"]
      });
      continue;
    }

    const messages = rawThreads[i].getMessages();
    const msgDate = messages[messages.length - 1].getDate().getTime();
    const isFresh = msgDate >= freshThreshold;

    if (!isFresh) {
      // If it's old backlog, check if we have enough quota left to process it safely
      if ((quotaData.opsUsed + CONFIG.QUOTA_MANAGEMENT.OPS_PER_EMAIL) > CONFIG.QUOTA_MANAGEMENT.MAX_OPS_PER_DAY) {
        // Quota exceeded for backlog. Leave ai-ready on it and skip it for now.
        continue; 
      }
    }

    const senderRaw = messages[messages.length - 1].getFrom();
    const domain = extractDomain(senderRaw);

    if (!buckets[domain]) {
      if (domainCount >= CONFIG.MAX_BATCHES_PER_RUN) {
        // We've hit the max domains for this execution. Skip thread for now to avoid dropping it later.
        continue;
      }
      buckets[domain] = [];
      domainCount++;
    }

    if (buckets[domain].length < CONFIG.MAX_EMAILS_PER_BATCH) {
      // It fits in the batch! Queue it up and reserve the ops.
      buckets[domain].push(rawThreads[i]);
      threadsToProcess++;
      quotaData.opsUsed += CONFIG.QUOTA_MANAGEMENT.OPS_PER_EMAIL;
    }
  }
  
  // Save the updated quota math back to Drive properties immediately
  props.setProperty('QUOTA_DATA', JSON.stringify(quotaData));

  // If we cleaned up any zombies, push them to the log report
  if (skippedBatch.emails.length > 0) {
    jobLog.batches.push(skippedBatch);
  }

  // If there are no actual threads to send to the AI, write the log (if zombies existed) and exit
  if (threadsToProcess === 0) {
    if (jobLog.batches.length > 0) writeDailyLog(jobLog, logsFolderId);
    return;
  }
  
  const promptTemplate = DocumentApp.openById(promptDocId).getBody().getText();

  let existingCorrespondentTags = [];
  for (const entity of Object.keys(CONFIG.ENTITIES)) {
    existingCorrespondentTags.push(...getExistingTags(entity));
  }
  const existingPurposeTags = getExistingTags(CONFIG.PARENT_LABEL_PURPOSE);
  const availableBgColors = CONFIG.BACKGROUND_COLORS.join(', ');
  const availableTextColors = CONFIG.TEXT_COLORS.join(', ');

  let batchesProcessed = 0;
  
  for (const domain in buckets) {
    if (batchesProcessed >= CONFIG.MAX_BATCHES_PER_RUN) break;

    const domainThreads = buckets[domain];
    const payloadData = buildBatchPayload(domainThreads);
    
    // Format the key-value dictionary into a readable list for the AI
    let entityPromptText = "";
    for (const [key, value] of Object.entries(CONFIG.ENTITIES)) {
      entityPromptText += `- "${key}": ${value}\n`;
    }
    
    let finalPrompt = promptTemplate
      .replace('{{CORRESPONDENTS}}', existingCorrespondentTags.join(', '))
      .replace('{{ENTITIES}}', entityPromptText.trim())
      .replace('{{PURPOSES}}', existingPurposeTags.join(', '))
      .replace('{{IMPORTANT_RULE}}', CONFIG.FLAG_RULES.IMPORTANT) 
      .replace('{{STARRED_RULE}}', CONFIG.FLAG_RULES.STARRED)     
      .replace('{{DOMAIN}}', domain)
      .replace('{{PAYLOAD}}', payloadData);
    
    jobLog.apiCalls++; 
    batchesProcessed++;
    
    const apiResult = classifySenderBatch(finalPrompt, debugFolderId);
    
    let batchLog = {
      domain: domain,
      duration: apiResult.duration,
      tokens: apiResult.tokens,
      debug: apiResult.debug, // Added inline debug capture
      emails: []
    };

    const result = apiResult.data;
    
    if (apiResult.success && result && result.name && result.entityType && result.emails) {
      
      // Dynamic Routing: Use the AI's choice if it exists in our config
      let parentPath = result.entityType;
      
      // Fallback: If the AI hallucinates a non-existent entity, default to the first one in the config
      if (!CONFIG.ENTITIES[parentPath]) {
        parentPath = Object.keys(CONFIG.ENTITIES)[0]; 
      }

      let correspondentPath = `${parentPath}/${result.name}`;
      let correspondentLabel = null;
      
      // Blacklist Check: Correspondent
      if (!(CONFIG.BLACKLIST.DO_NOT_USE && isBlacklisted(result.name))) {
        correspondentLabel = getOrCreateLabel(correspondentPath, result.name);
        if (correspondentLabel) {
          let bgColor = "#ffffff";
          let textColor = "#000000";
          setLabelColor(correspondentPath, bgColor, textColor);
        }
      }

      for (let j = 0; j < result.emails.length; j++) {
        const emailAI = result.emails[j];
        if (emailAI.index >= domainThreads.length || emailAI.index < 0) continue; 
        
        const thread = domainThreads[emailAI.index]; 
        const latestMessage = thread.getMessages()[thread.getMessages().length - 1];
        
        let appliedTags = [CONFIG.LABEL_COMPLETE];
        
        // Apply Correspondent if it passed the blacklist
        if (correspondentLabel) {
          thread.addLabel(correspondentLabel); 
          appliedTags.push(correspondentPath);
        }

        // Blacklist Check: Purpose
        if (emailAI.purpose && !(CONFIG.BLACKLIST.DO_NOT_USE && isBlacklisted(emailAI.purpose))) {
          let pLower = emailAI.purpose.trim().toLowerCase();
          if (pLower === 'update' || pLower === 'updates') {
            emailAI.category = "Updates";
          } else {
            let purposePath = CONFIG.PARENT_LABEL_PURPOSE ? `${CONFIG.PARENT_LABEL_PURPOSE}/${emailAI.purpose}` : emailAI.purpose;
            let purposeLabel = getOrCreateLabel(purposePath, emailAI.purpose);
            
            if (purposeLabel) {
              setLabelColor(purposePath, "#434343", "#ffffff"); // Dark Gray default
              thread.addLabel(purposeLabel);
              appliedTags.push(purposePath);
            }
          }
        }

        if (["Primary", "Promotions", "Social", "Updates", "Forums"].includes(emailAI.category)) {
          setSystemCategory(thread.getId(), emailAI.category);
          appliedTags.push(`Category: ${emailAI.category}`);
        }

        if (emailAI.isImportant) {
          thread.markImportant();
          appliedTags.push("Important");
        } else {
          thread.markUnimportant();
        }

        if (emailAI.isStarred) {
          latestMessage.star();
          appliedTags.push("Starred");
        } else {
          latestMessage.unstar();
        }

        // --- V2.0.0 CACHE INJECTION ---
        if (typeof ENABLE_SELF_TUNING !== 'undefined' && ENABLE_SELF_TUNING) {
          let aiLabels = appliedTags.filter(t => t !== CONFIG.LABEL_COMPLETE && !t.startsWith("Category:") && t !== "Important" && t !== "Starred");
          
          saveStateToCache(latestMessage.getId(), {
            labels: aiLabels,
            entity: result.entityType || "Unknown",
            isImportant: emailAI.isImportant || false,
            isStarred: emailAI.isStarred || false,
            timestamp: new Date().getTime()
          });
        }

        thread.addLabel(completeLabel);
        thread.removeLabel(readyLabel);

        batchLog.emails.push({
          subject: latestMessage.getSubject(),
          snippet: latestMessage.getPlainBody().substring(0, 60).replace(/\s+/g, ' ') + "...",
          link: thread.getPermalink(),
          before: [CONFIG.LABEL_READY],
          after: appliedTags
        });
      }
    } else {
      // THE QUARANTINE PROTOCOL (If the AI hallucinates bad JSON)
      for (let k = 0; k < domainThreads.length; k++) {
        const thread = domainThreads[k];
        const failMsg = thread.getMessages()[thread.getMessages().length - 1];
        
        thread.addLabel(failedLabel);
        thread.removeLabel(readyLabel);
        
        batchLog.emails.push({
          subject: failMsg.getSubject(),
          snippet: failMsg.getPlainBody().substring(0, 60).replace(/\s+/g, ' ') + "...",
          link: thread.getPermalink(),
          before: [CONFIG.LABEL_READY],
          after: [CONFIG.LABEL_FAILED]
        });
      }
    }
    
    jobLog.batches.push(batchLog);
  }

  if (jobLog.batches.length > 0) {
    writeDailyLog(jobLog, logsFolderId);
  }
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Purpose: Retrieves and updates the user's API quota data.
 * Input: props (Properties)
 * Output: Returns the current quota object.
 * Importance: Ensures the script tracks API usage and prevents exceeding daily limits.
 */
function getAndUpdateQuota(props) {
  let quotaString = props.getProperty('QUOTA_DATA');
  let now = Date.now();
  let quota = quotaString ? JSON.parse(quotaString) : null;

  // 86400000 ms = 24 hours. Reset quota if a full day has passed.
  if (!quota || (now - quota.windowStart > 86400000)) {
    quota = {
      windowStart: now,
      opsUsed: 0
    };
  }
  return quota;
}

/**
 * Purpose: Writes debug information to a text file in the debug folder.
 * Input: logText (String), debugFolderId (String)
 * Output: Creates or updates a debug log file in Google Drive.
 * Importance: Provides a record of raw API interactions for troubleshooting.
 */
function writeDebugLog(logText, debugFolderId) {
  if (!CONFIG.DEBUG_MODE || !debugFolderId) return;
  try {
    const folder = DriveApp.getFolderById(debugFolderId);
    const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd_HH");
    const fileName = \`Debug_\${dateStr}.txt\`;
    const files = folder.getFilesByName(fileName);
    
    const timestamp = new Date().toLocaleTimeString();
    const formattedLog = \`\\n==========================================\\n[\${timestamp}]\\n\${logText}\\n\`;
    
    if (files.hasNext()) {
      let file = files.next();
      file.setContent(file.getBlob().getDataAsString() + formattedLog);
    } else {
      folder.createFile(fileName, formattedLog, MimeType.PLAIN_TEXT);
    }
  } catch (e) {
    Logger.log("Failed to write debug log: " + e.toString());
  }
}

/**
 * Purpose: Generates an HTML report of the processed batches and saves it to Google Drive.
 * Input: jobLog (Object), logsFolderId (String)
 * Output: Creates or appends an HTML log file in the logs folder.
 * Importance: Provides the user with a readable summary of actions taken by the script.
 */
function writeDailyLog(jobLog, logsFolderId) {
  const folder = DriveApp.getFolderById(logsFolderId);
  const dateStr = Utilities.formatDate(jobLog.startTime, Session.getScriptTimeZone(), "yyyy-MM-dd_HH");
  const fileName = \`Log_\${dateStr}.html\`;
  const files = folder.getFilesByName(fileName);
  
  const escapeHtml = (str) => {
    return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };

  // Advanced CSS Block (Light/Dark Mode)
  const cssStyles = \`
    <style>
      :root {
        --bg-page: #f9f9f9; --text-main: #222; --text-sub: #666; --bg-card: #fff; --border: #ccc;
        --bg-header: #f4f4f4; --bg-batch: #e8f0fe; --bg-batch-fail: #fce8e6; 
        --text-batch: #1a73e8; --text-batch-fail: #c5221f; --bg-th: #fafafa; --border-td: #eee;
        --link: #1a73e8; --bg-tag: #e0e0e0; --text-tag: #333; --bg-tag-success: #e6f4ea;
        --text-tag-success: #137333; --bg-tag-fail: #fce8e6; --text-tag-fail: #c5221f;
        --bg-debug: #202124; --text-debug: #e8eaed;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg-page: #1e1e1e; --text-main: #e0e0e0; --text-sub: #aaa; --bg-card: #2d2d2d; --border: #444;
          --bg-header: #383838; --bg-batch: #174ea6; --bg-batch-fail: #601410; 
          --text-batch: #8ab4f8; --text-batch-fail: #f28b82; --bg-th: #333; --border-td: #444;
          --link: #8ab4f8; --bg-tag: #555; --text-tag: #ddd; --bg-tag-success: #0d652d;
          --text-tag-success: #81c995; --bg-tag-fail: #8c1d18; --text-tag-fail: #f28b82;
          --bg-debug: #121212; --text-debug: #b5b5b5;
        }
      }
      body { padding: 10px; background-color: var(--bg-page); margin: 0; font-family: sans-serif; }
      .card { border: 1px solid var(--border); border-radius: 4px; margin-bottom: 15px; overflow: hidden; font-size: 13px; background: var(--bg-card); color: var(--text-main); }
      .header { background-color: var(--bg-header); padding: 6px 10px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
      .batch-hdr { padding: 4px 10px; border-bottom: 1px solid var(--border); border-top: 1px solid var(--border); }
      .batch-success { background-color: var(--bg-batch); color: var(--text-batch); }
      .batch-fail { background-color: var(--bg-batch-fail); color: var(--text-batch-fail); }
      table { table-layout: fixed; width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; }
      th { padding: 4px 8px; border-bottom: 1px solid var(--border); background: var(--bg-th); }
      td { padding: 4px 8px; border-bottom: 1px solid var(--border-td); word-wrap: break-word; overflow-wrap: break-word; }
      a.subject-link { color: var(--link); text-decoration: none; font-weight: bold; }
      .snippet { font-size: 10px; color: var(--text-sub); font-style: italic; display: block; margin-top: 2px; }
      .tag { display: inline-block; padding: 2px 4px; border-radius: 2px; font-size: 10px; margin: 1px; text-decoration: none; }
      .tag-before { background: var(--bg-tag); color: var(--text-tag); }
      .tag-after { background: var(--bg-tag-success); color: var(--text-tag-success); }
      .tag-fail { background: var(--bg-tag-fail); color: var(--text-tag-fail); }
      details summary { cursor: pointer; color: var(--text-sub); font-weight: bold; outline: none; }
      .debug-box { margin-top: 5px; padding: 8px; background: var(--bg-debug); color: var(--text-debug); border-radius: 4px; overflow-x: auto; white-space: pre-wrap; font-family: monospace; font-size: 11px;}
    </style>
  \`;

  let runHtml = \`<div class="card">
      <div class="header">
        <strong>Job Run: \${jobLog.startTime.toLocaleTimeString()}</strong>
        <span style="font-size: 12px;">Ops Used (24h): <strong>\${jobLog.quota ? jobLog.quota.opsUsed : 0} / \${CONFIG.QUOTA_MANAGEMENT.MAX_OPS_PER_DAY}</strong> &nbsp;|&nbsp; API Calls: <strong>\${jobLog.apiCalls}</strong></span>
      </div>\`;
      
  for (let batch of jobLog.batches) {
    let hasFailure = batch.emails.some(e => e.after.some(tag => tag.toLowerCase().includes('failed')));
    let batchClass = hasFailure ? 'batch-hdr batch-fail' : 'batch-hdr batch-success';

    runHtml += \`
      <div class="\${batchClass}">
        <strong>\${batch.domain}</strong>
        <span style="font-size: 11px; margin-left: 10px;">[Time: \${batch.duration}s | Tokens: \${batch.tokens.total}]</span>
      </div>
      <table>
        <tr>
          <th style="width: 40%;">Email Subject</th>
          <th style="width: 20%;">Before</th>
          <th style="width: 40%;">After</th>
        </tr>\`;
        
    for (let email of batch.emails) {
      let linkedTags = email.after.map(tag => {
        let isFail = tag.toLowerCase().includes('failed') || tag.toLowerCase().includes('skipped');
        let tagClass = isFail ? 'tag tag-fail' : 'tag tag-after';
        let searchQuery = encodeURIComponent('label:' + tag.replace('Category: ', 'category:').replace('Important', '^i').replace('Starred', '^s'));
        return \`<a href="https://mail.google.com/mail/u/0/#search/\${searchQuery}" target="_blank" class="\${tagClass}">\${tag}</a>\`;
      }).join("");

      runHtml += \`
        <tr>
          <td>
            <a href="\${email.link}" target="_blank" class="subject-link">\${email.subject}</a>
            <span class="snippet">\${email.snippet ? email.snippet : ''}</span>
          </td>
          <td><span class="tag tag-before">\${email.before.join(", ")}</span></td>
          <td>\${linkedTags}</td>
        </tr>\`;
    }
    runHtml += \`</table>\`;
    
    // Accordion for inline debug
    if (batch.debug) {
      runHtml += \`
        <div style="padding: 4px 8px; border-bottom: 1px solid var(--border);">
          <details>
            <summary>View Raw API Debug Info</summary>
            <div class="debug-box"><span style="color: #8ab4f8;">// PROMPT SENT</span>\\n\${escapeHtml(batch.debug.prompt)}\\n\\n<span style="color: #8ab4f8;">// RAW RESPONSE</span>\\n\${escapeHtml(batch.debug.response)}</div>
          </details>
        </div>\`;
    }
  }
  
  runHtml += \`</div>\`;

  if (files.hasNext()) {
    let file = files.next();
    let content = file.getBlob().getDataAsString();
    file.setContent(content.replace("</body>", runHtml + "\\n</body>"));
  } else {
    let baseHtml = \`<!DOCTYPE html><html><head><title>Classification Log: \${dateStr}</title>
    \${cssStyles}
    </head>
    <body>
      <h3 style="margin-top: 0; color: var(--text-main);">Email AI Processing Log - \${dateStr} <span style="font-size: 12px; font-weight: normal; color: var(--text-sub);">(v\${CONFIG.VERSION})</span></h3>
      \${runHtml}
    </body></html>\`;
    folder.createFile(fileName, baseHtml, MimeType.HTML);
  }
}

/**
 * Purpose: Constructs the text payload from a batch of email threads to send to the AI.
 * Input: threads (Array)
 * Output: Returns a formatted string containing sender, subject, and body snippets.
 * Importance: Formats the email data in a structured way that the AI model can process.
 */
function buildBatchPayload(threads) {
  let text = "";
  for (let i = 0; i < threads.length; i++) {
    const msgs = threads[i].getMessages();
    const msg = msgs[msgs.length - 1];
    text += \`\\n--- EMAIL INDEX: \${i} ---\\nSpecific Sender: \${msg.getFrom()}\\nSubject: \${msg.getSubject()}\\nBody: \${msg.getPlainBody().substring(0, 1500)}\\n\`; 
  }
  return text;
}

/**
 * Purpose: Sends the prompt to the Gemini API and parses the response.
 * Input: finalPromptText (String), debugFolderId (String)
 * Output: Returns an object containing success status, parsed data, duration, token usage, and debug info.
 * Importance: This function interacts directly with the AI model to determine email classifications.
 */
function classifySenderBatch(finalPromptText, debugFolderId) {
  const url = \`https://generativelanguage.googleapis.com/v1beta/models/\${CONFIG.GEMINI_MODEL}:generateContent?key=\${SECRETS.GEMINI_API_KEY}\`;
  const payload = { contents: [{ parts: [{ text: finalPromptText }] }] };
  const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };

  let rawResponse = "";
  let startTime = Date.now();
  let duration = 0;
  let tokens = { total: 0, prompt: 0, candidates: 0 };
  let debugData = null;

  try {
    const response = UrlFetchApp.fetch(url, options);
    duration = ((Date.now() - startTime) / 1000).toFixed(2);
    rawResponse = response.getContentText();
    const json = JSON.parse(rawResponse);
    
    if (json.usageMetadata) {
      tokens.total = json.usageMetadata.totalTokenCount || 0;
      tokens.prompt = json.usageMetadata.promptTokenCount || 0;
      tokens.candidates = json.usageMetadata.candidatesTokenCount || 0;
    }

    if (CONFIG.DEBUG_MODE) {
      debugData = { prompt: finalPromptText, response: rawResponse };
    }
    
    if (json.candidates && json.candidates.length > 0) {
      let responseText = json.candidates[0].content.parts[0].text.trim();
      let cleanText = responseText.replace(/^\`\`\`json/i, '').replace(/\`\`\`$/i, '').trim();
      
      if (CONFIG.DEBUG_MODE) {
        writeDebugLog(\`SUCCESSFUL API CALL\\nDuration: \${duration}s | Tokens: \${tokens.total}\\nRaw AI Output:\\n\${responseText}\`, debugFolderId);
      }
      
      return { success: true, data: JSON.parse(cleanText), duration: duration, tokens: tokens, debug: debugData };
    } else {
      if (CONFIG.DEBUG_MODE) writeDebugLog(\`WARNING: API RETURNED NO CANDIDATES\\nDuration: \${duration}s\\nRaw HTTP Response:\\n\${rawResponse}\`, debugFolderId);
      return { success: false, data: null, duration: duration, tokens: tokens, debug: debugData };
    }
  } catch (e) { 
    duration = ((Date.now() - startTime) / 1000).toFixed(2);
    Logger.log("Error in AI call: " + e.toString()); 
    if (CONFIG.DEBUG_MODE) {
      debugData = { prompt: finalPromptText, response: rawResponse + "\\n\\nError: " + e.toString() };
      writeDebugLog(\`CRITICAL FAILURE\\nDuration: \${duration}s\\nError Message: \${e.toString()}\\n\\nRaw HTTP Response:\\n\${rawResponse}\\n\\nPrompt Sent:\\n\${finalPromptText}\`, debugFolderId);
    }
    return { success: false, data: null, duration: duration, tokens: tokens, debug: debugData };
  }
}

/**
 * Purpose: Extracts the domain name from a raw sender string.
 * Input: rawSender (String)
 * Output: Returns the lowercased domain string.
 * Importance: Used to group emails by sender domain for batch processing.
 */
function extractDomain(rawSender) {
  const match = rawSender.match(/<.+@(.+)>/);
  return match ? match[1].toLowerCase() : rawSender.split('@').pop().toLowerCase();
}

/**
 * Purpose: Applies a specified background and text color to a Gmail label.
 * Input: labelName (String), backgroundColor (String), textColor (String)
 * Output: Modifies the color of the specified label via the Advanced Gmail API.
 * Importance: Visually distinguishes labels in the Gmail interface.
 */
function setLabelColor(labelName, backgroundColor, textColor) {
  try {
    const labels = Gmail.Users.Labels.list('me').labels;
    const label = labels.find(l => l.name === labelName);
    if (!label) return;
    Gmail.Users.Labels.patch({ color: { backgroundColor, textColor } }, 'me', label.id);
  } catch (e) {}
}

/**
 * Purpose: Assigns a built-in Gmail category to a thread.
 * Input: threadId (String), categoryName (String)
 * Output: Modifies the thread's labels via the Advanced Gmail API.
 * Importance: Properly sorts emails into Gmail's native category tabs.
 */
function setSystemCategory(threadId, categoryName) {
  const categoryMap = { "Promotions": "CATEGORY_PROMOTIONS", "Social": "CATEGORY_SOCIAL", "Updates": "CATEGORY_UPDATES", "Forums": "CATEGORY_FORUMS", "Primary": "CATEGORY_PERSONAL" };
  if (!categoryMap[categoryName]) return;
  try { Gmail.Users.Threads.modify({ addLabelIds: [categoryMap[categoryName]] }, 'me', threadId); } catch (e) {}
}

/**
 * Purpose: Retrieves existing sub-labels under a specified parent category.
 * Input: parentCategoryName (String)
 * Output: Returns an array of existing label names (without the parent prefix).
 * Importance: Used to inform the AI about currently available tags to reuse.
 */
function getExistingTags(parentCategoryName) {
  const labels = GmailApp.getUserLabels(), existing = [];
  const prefix = parentCategoryName ? \`\${parentCategoryName}/\` : '';
  
  for (let i = 0; i < labels.length; i++) {
    try {
      let name = labels[i].getName();
      if (prefix && name.startsWith(prefix)) existing.push(name.replace(prefix, ''));
      else if (!prefix) existing.push(name);
    } catch (e) {
      // Silently skip any ghost label references (e.g., Object with id 88)
      continue;
    }
  }
  return existing;
}

/**
 * Purpose: Retrieves an existing label or creates it if it does not exist and is not blacklisted.
 * Input: labelPath (String), baseTerm (String)
 * Output: Returns a GmailLabel object or null if blacklisted.
 * Importance: Ensures the necessary label structure exists before trying to apply it to a thread.
 */
function getOrCreateLabel(labelPath, baseTerm) {
  let label = GmailApp.getUserLabelByName(labelPath);
  if (label) return label; // Label exists, safe to return
  
  // Label doesn't exist. Check if we are forbidden from creating it.
  if (baseTerm && CONFIG.BLACKLIST.DO_NOT_CREATE && isBlacklisted(baseTerm)) {
    return null; 
  }
  return GmailApp.createLabel(labelPath);
}

/**
 * Purpose: Checks if a proposed term is on the user's blacklist.
 * Input: term (String)
 * Output: Returns a boolean indicating if the term is blacklisted.
 * Importance: Prevents the creation or usage of labels that the user has explicitly forbidden.
 */
function isBlacklisted(term) {
  if (!term || !CONFIG.BLACKLIST || !CONFIG.BLACKLIST.TERMS) return false;
  const lowerTerm = term.toLowerCase();
  return CONFIG.BLACKLIST.TERMS.some(t => t.toLowerCase() === lowerTerm);
}

/**
 * Purpose: Logs the remaining daily quota for sending emails.
 * Input: None
 * Output: Logs the quota value to the Apps Script console.
 * Importance: Useful for manual debugging and checking email limits.
 */
function what() {
  Logger.log(MailApp.getRemainingDailyQuota());
}

/**
 * Purpose: Triggered daily to check and set branding colors for newly created entity labels.
 * Input: None
 * Output: Modifies Gmail label colors via the Advanced Gmail API.
 * Importance: Ensures the visual aesthetic of newly created labels remains consistent with the system's branding without manual intervention.
 */
function updateLabelBrandingColors() {
  let allLabelsResponse;
  try {
    allLabelsResponse = Gmail.Users.Labels.list('me');
  } catch (e) {
    return; // Advanced Gmail service might be unavailable
  }
  const allLabels = allLabelsResponse.labels || [];
  
  const entityKeys = Object.keys(CONFIG.ENTITIES);
  const labelsToUpdate = [];
  
  for (const label of allLabels) {
    if (label.type === 'user' && label.name.includes('/')) {
      const parts = label.name.split('/');
      if (entityKeys.includes(parts[0]) && parts.length === 2) {
         if (label.color && label.color.backgroundColor === '#ffffff' && label.color.textColor === '#000000') {
            labelsToUpdate.push(label);
         } else if (!label.color) { 
            labelsToUpdate.push(label);
         }
      }
    }
  }

  if (labelsToUpdate.length === 0) return;
  
  const batch = labelsToUpdate.slice(0, 10);
  const names = batch.map(l => l.name);
  
  const availableBgColors = CONFIG.BACKGROUND_COLORS.join(', ');
  const availableTextColors = CONFIG.TEXT_COLORS.join(', ');

  const prompt = \`You are a branding expert. For each of the following entity names, identify their primary and secondary branding colors.
Entity Names:
\${names.join('\\n')}

Pick the closest matching background color from this list for the primary color: [\${availableBgColors}]. Default to "#ffffff".
Pick the closest matching text color from this list for the secondary color: [\${availableTextColors}]. Default to "#000000".

Return ONLY a raw JSON object mapping the exact entity name to an object with 'backgroundColor' and 'textColor'.
Format:
{
  "Financial/Chase Bank": { "backgroundColor": "#123456", "textColor": "#ffffff" }
}\`;

  const apiKey = SECRETS.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') return;

  const url = \`https://generativelanguage.googleapis.com/v1beta/models/\${CONFIG.GEMINI_MODEL}:generateContent?key=\${apiKey}\`;
  const payload = {
    "contents": [{ "parts": [{ "text": prompt }] }],
    "generationConfig": { "temperature": 0.1 }
  };
  
  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(response.getContentText());
    if (data.candidates && data.candidates.length > 0) {
      let text = data.candidates[0].content.parts[0].text;
      text = text.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
      const colors = JSON.parse(text);
      for (const label of batch) {
         if (colors[label.name]) {
             const c = colors[label.name];
             if (CONFIG.BACKGROUND_COLORS.includes(c.backgroundColor) && CONFIG.TEXT_COLORS.includes(c.textColor)) {
                 try {
                     Gmail.Users.Labels.patch({ color: { backgroundColor: c.backgroundColor, textColor: c.textColor } }, 'me', label.id);
                 } catch (e) {}
             }
         }
      }
    }
  } catch (e) {}
}