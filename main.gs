/**
 * NEXUS FOR GMAIL - CORE ENGINE
 * Contains the main execution pipeline and helper utilities.
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

  // Initialize the log immediately
  let jobLog = {
    startTime: new Date(),
    apiCalls: 0,
    batches: [] 
  };

  // Special batch just for tracking conflict resolution
  let skippedBatch = {
    domain: "System Cleanup (Ignored Zombie Threads)",
    duration: "0.00",
    tokens: { total: 0, prompt: 0, candidates: 0 },
    emails: []
  };

  // CONFLICT RESOLUTION: Filter out zombie threads and log them
  const threads = [];
  for (let i = 0; i < rawThreads.length; i++) {
    const labels = rawThreads[i].getLabels();
    const hasComplete = labels.some(l => l.getName() === CONFIG.LABEL_COMPLETE);
    
    if (hasComplete) {
      rawThreads[i].removeLabel(readyLabel);
      const latestMessage = rawThreads[i].getMessages()[rawThreads[i].getMessages().length - 1];
      
      // Add it to our telemetry report
      skippedBatch.emails.push({
        subject: latestMessage.getSubject(),
        link: rawThreads[i].getPermalink(),
        before: [CONFIG.LABEL_READY, CONFIG.LABEL_COMPLETE],
        after: [CONFIG.LABEL_COMPLETE]
      });
    } else {
      threads.push(rawThreads[i]);
    }
  }
  
  // If we cleaned up any zombies, push them to the log report
  if (skippedBatch.emails.length > 0) {
    jobLog.batches.push(skippedBatch);
  }

  // If there are no actual threads to send to the AI, write the log (if zombies existed) and exit
  if (threads.length === 0) {
    if (jobLog.batches.length > 0) writeDailyLog(jobLog, logsFolderId);
    return;
  }
  
  const promptTemplate = DocumentApp.openById(promptDocId).getBody().getText();

  const buckets = {};
  for (let i = 0; i < threads.length; i++) {
    const messages = threads[i].getMessages();
    const senderRaw = messages[messages.length - 1].getFrom();
    const domain = extractDomain(senderRaw);
    
    if (!buckets[domain]) buckets[domain] = [];
    if (buckets[domain].length < CONFIG.MAX_EMAILS_PER_BATCH) {
      buckets[domain].push(threads[i]);
    }
  }

  let existingCorrespondentTags = [];
  for (const entity of Object.keys(CONFIG.ENTITIES)) {
    existingCorrespondentTags.push(...getExistingTags(entity));
  }
  const existingPurposeTags = getExistingTags(CONFIG.PARENT_LABEL_PURPOSE);
  const availableColors = Object.keys(CONFIG.PALETTE).join(', ');

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
      .replace('{{COLORS}}', availableColors)
      .replace('{{PURPOSES}}', existingPurposeTags.join(', '))
      .replace('{{IMPORTANT_RULE}}', CONFIG.FLAG_RULES.IMPORTANT) // NEW
      .replace('{{STARRED_RULE}}', CONFIG.FLAG_RULES.STARRED)     // NEW
      .replace('{{DOMAIN}}', domain)
      .replace('{{PAYLOAD}}', payloadData);
    
    jobLog.apiCalls++; 
    batchesProcessed++;
    
    const apiResult = classifySenderBatch(finalPrompt, debugFolderId);
    
    let batchLog = {
      domain: domain,
      duration: apiResult.duration,
      tokens: apiResult.tokens,
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
          let colorProfile = CONFIG.PALETTE[result.color] || CONFIG.PALETTE["Gray"];
          setLabelColor(correspondentPath, colorProfile.bg, colorProfile.text);
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
          let purposePath = CONFIG.PARENT_LABEL_PURPOSE ? `${CONFIG.PARENT_LABEL_PURPOSE}/${emailAI.purpose}` : emailAI.purpose;
          let purposeLabel = getOrCreateLabel(purposePath, emailAI.purpose);
          
          if (purposeLabel) {
            setLabelColor(purposePath, CONFIG.PALETTE["Dark Gray"].bg, CONFIG.PALETTE["Dark Gray"].text);
            thread.addLabel(purposeLabel);
            appliedTags.push(purposePath);
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

        thread.addLabel(completeLabel);
        thread.removeLabel(readyLabel);

        batchLog.emails.push({
          subject: latestMessage.getSubject(),
          link: thread.getPermalink(),
          before: [CONFIG.LABEL_READY],
          after: appliedTags
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

function writeDebugLog(logText, debugFolderId) {
  if (!CONFIG.DEBUG_MODE || !debugFolderId) return;
  try {
    const folder = DriveApp.getFolderById(debugFolderId);
    const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    const fileName = `Debug_${dateStr}.txt`;
    const files = folder.getFilesByName(fileName);
    
    const timestamp = new Date().toLocaleTimeString();
    const formattedLog = `\n==========================================\n[${timestamp}]\n${logText}\n`;
    
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

function writeDailyLog(jobLog, logsFolderId) {
  const folder = DriveApp.getFolderById(logsFolderId);
  const dateStr = Utilities.formatDate(jobLog.startTime, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const fileName = `Log_${dateStr}.html`;
  const files = folder.getFilesByName(fileName);
  
  // Compact Base Wrapper
  let runHtml = `
    <div style="border: 1px solid #ccc; border-radius: 4px; margin-bottom: 15px; overflow: hidden; font-family: sans-serif; font-size: 13px;">
      
      <div style="background-color: #f4f4f4; padding: 6px 10px; border-bottom: 1px solid #ccc; display: flex; justify-content: space-between; align-items: center;">
        <strong style="color: #333; font-size: 13px;">Job Run: ${jobLog.startTime.toLocaleTimeString()}</strong>
        <span style="color: #666; font-size: 12px;">API Calls: <strong>${jobLog.apiCalls}</strong></span>
      </div>`;
      
  for (let batch of jobLog.batches) {
    runHtml += `
      <div style="background-color: #e8f0fe; padding: 4px 10px; border-bottom: 1px solid #ccc; border-top: 1px solid #ccc;">
        <strong style="color: #1a73e8; font-size: 12px;">${batch.domain}</strong>
        <span style="font-size: 11px; color: #555; margin-left: 10px;">
          [Time: ${batch.duration}s | Tokens: ${batch.tokens.total}]
        </span>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 12px;">
        <tr>
          <th style="padding: 4px 8px; border-bottom: 1px solid #ccc; background: #fafafa; width: 45%;">Email Subject</th>
          <th style="padding: 4px 8px; border-bottom: 1px solid #ccc; background: #fafafa; width: 20%;">Before</th>
          <th style="padding: 4px 8px; border-bottom: 1px solid #ccc; background: #fafafa; width: 35%;">After</th>
        </tr>`;
        
    for (let email of batch.emails) {
      runHtml += `
        <tr>
          <td style="padding: 4px 8px; border-bottom: 1px solid #eee;">
            <a href="${email.link}" target="_blank" style="color: #1a73e8; text-decoration: none;">${email.subject}</a>
          </td>
          <td style="padding: 4px 8px; border-bottom: 1px solid #eee;">
            <span style="background: #e0e0e0; padding: 2px 4px; border-radius: 2px; font-size: 10px;">${email.before.join(", ")}</span>
          </td>
          <td style="padding: 4px 8px; border-bottom: 1px solid #eee;">
            ${email.after.map(tag => `<span style="background: ${tag.includes('failed') ? '#fce8e6' : '#e6f4ea'}; color: ${tag.includes('failed') ? '#c5221f' : '#137333'}; padding: 2px 4px; border-radius: 2px; font-size: 10px; display: inline-block; margin: 1px;">${tag}</span>`).join("")}
          </td>
        </tr>`;
    }
    runHtml += `</table>`;
  }
  
  runHtml += `</div>`;

  if (files.hasNext()) {
    let file = files.next();
    let content = file.getBlob().getDataAsString();
    file.setContent(content.replace("</body>", runHtml + "\n</body>"));
  } else {
    // Compact Main HTML Frame
    let baseHtml = `<!DOCTYPE html><html><head><title>Classification Log: ${dateStr}</title></head>
    <body style="padding: 10px; background-color: #f9f9f9; margin: 0;">
      <h3 style="font-family: sans-serif; color: #222; margin-top: 0;">Email AI Processing Log - ${dateStr} <span style="font-size: 12px; font-weight: normal; color: #666;">(v${CONFIG.VERSION})</span></h3>
      ${runHtml}
    </body></html>`;
    
    folder.createFile(fileName, baseHtml, MimeType.HTML);
  }
}

function buildBatchPayload(threads) {
  let text = "";
  for (let i = 0; i < threads.length; i++) {
    const msgs = threads[i].getMessages();
    const msg = msgs[msgs.length - 1];
    text += `\n--- EMAIL INDEX: ${i} ---\nSpecific Sender: ${msg.getFrom()}\nSubject: ${msg.getSubject()}\nBody: ${msg.getPlainBody().substring(0, 1500)}\n`; 
  }
  return text;
}

function classifySenderBatch(finalPromptText, debugFolderId) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${SECRETS.GEMINI_API_KEY}`;
  const payload = { contents: [{ parts: [{ text: finalPromptText }] }] };
  const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };

  let rawResponse = "";
  let startTime = Date.now();
  let duration = 0;
  let tokens = { total: 0, prompt: 0, candidates: 0 };

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
    
    if (json.candidates && json.candidates.length > 0) {
      let responseText = json.candidates[0].content.parts[0].text.trim();
      let cleanText = responseText.replace(/^```json/i, '').replace(/```$/i, '').trim();
      
      if (CONFIG.DEBUG_MODE) {
        writeDebugLog(`SUCCESSFUL API CALL\nDuration: ${duration}s | Tokens: ${tokens.total}\nRaw AI Output:\n${responseText}`, debugFolderId);
      }
      
      return { success: true, data: JSON.parse(cleanText), duration: duration, tokens: tokens };
    } else {
      if (CONFIG.DEBUG_MODE) writeDebugLog(`WARNING: API RETURNED NO CANDIDATES\nDuration: ${duration}s\nRaw HTTP Response:\n${rawResponse}`, debugFolderId);
      return { success: false, data: null, duration: duration, tokens: tokens };
    }
  } catch (e) { 
    duration = ((Date.now() - startTime) / 1000).toFixed(2);
    Logger.log("Error in AI call: " + e.toString()); 
    if (CONFIG.DEBUG_MODE) {
      writeDebugLog(`CRITICAL FAILURE\nDuration: ${duration}s\nError Message: ${e.toString()}\n\nRaw HTTP Response:\n${rawResponse}\n\nPrompt Sent:\n${finalPromptText}`, debugFolderId);
    }
    return { success: false, data: null, duration: duration, tokens: tokens };
  }
}

function extractDomain(rawSender) {
  const match = rawSender.match(/<.+@(.+)>/);
  return match ? match[1].toLowerCase() : rawSender.split('@').pop().toLowerCase();
}

function setLabelColor(labelName, backgroundColor, textColor) {
  try {
    const labels = Gmail.Users.Labels.list('me').labels;
    const label = labels.find(l => l.name === labelName);
    if (!label) return;
    Gmail.Users.Labels.patch({ color: { backgroundColor, textColor } }, 'me', label.id);
  } catch (e) {}
}

function setSystemCategory(threadId, categoryName) {
  const categoryMap = { "Promotions": "CATEGORY_PROMOTIONS", "Social": "CATEGORY_SOCIAL", "Updates": "CATEGORY_UPDATES", "Forums": "CATEGORY_FORUMS", "Primary": "CATEGORY_PERSONAL" };
  if (!categoryMap[categoryName]) return;
  try { Gmail.Users.Threads.modify({ addLabelIds: [categoryMap[categoryName]] }, 'me', threadId); } catch (e) {}
}

function getExistingTags(parentCategoryName) {
  const labels = GmailApp.getUserLabels(), existing = [];
  const prefix = parentCategoryName ? `${parentCategoryName}/` : '';
  for (let i = 0; i < labels.length; i++) {
    let name = labels[i].getName();
    if (prefix && name.startsWith(prefix)) existing.push(name.replace(prefix, ''));
    else if (!prefix) existing.push(name);
  }
  return existing;
}

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
 * Checks if a proposed term is on the user's blacklist.
 */
function isBlacklisted(term) {
  if (!term || !CONFIG.BLACKLIST || !CONFIG.BLACKLIST.TERMS) return false;
  const lowerTerm = term.toLowerCase();
  return CONFIG.BLACKLIST.TERMS.some(t => t.toLowerCase() === lowerTerm);
}
