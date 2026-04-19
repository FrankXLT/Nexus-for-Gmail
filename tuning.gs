/**
 * Purpose: Appends the AI's original decision to today's cache file.
 * Input: messageId (String), stateObj (Object)
 * Output: Modifies the cache file in Google Drive.
 * Importance: Saves the original AI classification state so it can be compared against user corrections later.
 */
function saveStateToCache(messageId, stateObj) {
  const folder = getOrCreateCacheFolder();
  const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const fileName = `Cache_${dateStr}.json`;
  
  let cacheFile = getOrCreateFile(folder, fileName, "{}");
  let cacheData = JSON.parse(cacheFile.getBlob().getDataAsString());
  
  cacheData[messageId] = stateObj;
  cacheFile.setContent(JSON.stringify(cacheData));
}

/**
 * Purpose: Hunts for the ai-correct label, reads the cache, and writes the delta to the ledger.
 * Input: None
 * Output: Modifies the ledger file in Google Drive and removes the ai-correct label from threads.
 * Importance: Captures user manual corrections to build a dataset for self-tuning.
 */
function processCorrections() {
  if (!ENABLE_SELF_TUNING) return;
  
  const label = GmailApp.getUserLabelByName(CORRECTION_LABEL);
  if (!label) return;
  
  const threads = label.getThreads();
  if (threads.length === 0) return;

  const rootFolder = getRootNexusFolder(); // Assumes helper exists in main.gs
  const ledgerFile = getOrCreateFile(rootFolder, "Nexus_Corrections_Ledger.json", "[]");
  let ledgerData = JSON.parse(ledgerFile.getBlob().getDataAsString());

  threads.forEach(thread => {
    const messages = thread.getMessages();
    const lastMessage = messages[messages.length - 1];
    const msgId = lastMessage.getId();
    
    // Extract current manually corrected state
    const currentLabels = thread.getLabels().map(l => l.getName()).filter(n => n !== CORRECTION_LABEL && n !== 'ai-ready' && n !== 'ai-done');
    const isImportant = thread.isImportant();
    const hasStar = thread.hasStarredMessages();

    // Look up original AI state across the cache files
    const cachedState = findInCacheFiles(msgId) || "NOT_CACHED_OR_EXPIRED";

    ledgerData.push({
      date: new Date().toISOString(),
      sender: lastMessage.getFrom(),
      subject: lastMessage.getSubject(),
      aiOriginalState: cachedState,
      userCorrectedState: {
        labels: currentLabels,
        isImportant: isImportant,
        isStarred: hasStar
      }
    });

    thread.removeLabel(label);
  });

  ledgerFile.setContent(JSON.stringify(ledgerData, null, 2));
}

/**
 * Purpose: Sends the ledger and current rules to Gemini, updating the Google Doc with new rules.
 * Input: None
 * Output: Modifies the System Prompt Document and clears the ledger file.
 * Importance: Synthesizes user corrections into automated rules, enabling the system to learn and adapt over time.
 */
function tuneSystemPrompt() {
  if (!ENABLE_SELF_TUNING) return;

  const rootFolder = getRootNexusFolder();
  const ledgerFile = getOrCreateFile(rootFolder, "Nexus_Corrections_Ledger.json", "[]");
  const ledgerContent = ledgerFile.getBlob().getDataAsString();
  const ledgerData = JSON.parse(ledgerContent);
  
  if (ledgerData.length === 0) {
    cleanupCache(); // Run garbage collection while we're here
    return; // Nothing to tune
  }

  const docId = PropertiesService.getUserProperties().getProperty('SYSTEM_PROMPT_DOC_ID');
  const doc = DocumentApp.openById(docId);
  const body = doc.getBody();
  const text = body.getText();

  // Extract the Safe Zone to commit the changes 
  const startIndex = text.indexOf("[START_AUTOTUNED_RULES]");
  const endIndex = text.indexOf("[END_AUTOTUNED_RULES]");
  
  if (startIndex === -1 || endIndex === -1) {
    console.error("Safe Zone tags missing in System Prompt Document.");
    return;
  }

  const currentRules = text.substring(startIndex + 23, endIndex).trim();

  // Call Gemini to Synthesize
  const tuningPrompt = `
You are an expert prompt engineer optimizing an email classification system.
CURRENT LEARNED RULES:
${currentRules}

NEW USER CORRECTIONS (JSON):
${ledgerContent}

TASK:
1. Merge the new corrections into the current learned rules.
2. If a new correction contradicts an old rule, the new correction overrides it.
3. Condense patterns (e.g., summarize multiple corrections for the same domain into one rule).
4. Do not factor in "NOT_CACHED_OR_EXPIRED" original states; just enforce the new desired user state.
5. Output ONLY a clean, numbered list of plain-English rules. Do not include markdown formatting, conversational text, or introductions.
`;

  const newRules = callGeminiTuningAPI(tuningPrompt);
  
  // Replace old Safe Zone with new rules
  body.replaceText("\\[START_AUTOTUNED_RULES\\].*\\[END_AUTOTUNED_RULES\\]", ""); // Regex clear
  
  // Re-inject tags and new rules
  body.appendParagraph("[START_AUTOTUNED_RULES]");
  body.appendParagraph(newRules.trim());
  body.appendParagraph("[END_AUTOTUNED_RULES]");

  // Wipe the ledger clean for the next cycle
  ledgerFile.setContent("[]");
  
  // Garbage collection
  cleanupCache();
}

/**
 * Purpose: Purges daily cache files older than CACHE_RETENTION_DAYS.
 * Input: None
 * Output: Trashes old cache files in Google Drive.
 * Importance: Prevents infinite storage growth by cleaning up stale data.
 */
function cleanupCache() {
  const folder = getOrCreateCacheFolder();
  const files = folder.getFiles();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CACHE_RETENTION_DAYS);

  while (files.hasNext()) {
    const file = files.next();
    const match = file.getName().match(/Cache_(\d{4}-\d{2}-\d{2})\.json/);
    if (match) {
      const fileDate = new Date(match[1]);
      if (fileDate < cutoffDate) {
        file.setTrashed(true);
      }
    }
  }
}

// --- HELPER FUNCTIONS ---

function getOrCreateCacheFolder() {
  const rootFolder = getRootNexusFolder();
  const folders = rootFolder.getFoldersByName(CACHE_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : rootFolder.createFolder(CACHE_FOLDER_NAME);
}

function getOrCreateFile(folder, fileName, defaultContent) {
  const files = folder.getFilesByName(fileName);
  return files.hasNext() ? files.next() : folder.createFile(fileName, defaultContent, MimeType.PLAIN_TEXT);
}

function findInCacheFiles(messageId) {
  const folder = getOrCreateCacheFolder();
  const files = folder.getFiles();
  
  // Optional: Optimize by reading newest files first
  while (files.hasNext()) {
    const file = files.next();
    try {
      const data = JSON.parse(file.getBlob().getDataAsString());
      if (data[messageId]) {
        return data[messageId];
      }
    } catch (e) {
      console.error(`Error parsing cache file ${file.getName()}: ${e}`);
    }
  }
  return null;
}

/**
 * Purpose: Safely locates the root Nexus folder using the ID saved during setup.
 * Input: None
 * Output: Returns the Folder object for the root Nexus directory.
 * Importance: Provides a reliable way to find the master folder without relying on name matching.
 */
function getRootNexusFolder() {
  const props = PropertiesService.getUserProperties();
  const logsFolderId = props.getProperty('LOGS_FOLDER_ID');
  if (!logsFolderId) {
    throw new Error("System not initialized. Cannot locate root folder.");
  }
  // The master folder is the parent of the logs folder
  return DriveApp.getFolderById(logsFolderId).getParents().next();
}

/**
 * Purpose: A lightweight Gemini API caller dedicated to plain-text prompt synthesis.
 * Input: promptText (String)
 * Output: Returns the synthesized text from the Gemini model.
 * Importance: Provides a focused API calling method specifically for generating rules without parsing complex JSON.
 */
function callGeminiTuningAPI(promptText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${SECRETS.GEMINI_API_KEY}`;
  const payload = { contents: [{ parts: [{ text: promptText }] }] };
  const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
  
  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());
  
  if (json.candidates && json.candidates.length > 0) {
    return json.candidates[0].content.parts[0].text.trim();
  } else {
    throw new Error("Gemini returned no candidates during tuning: " + response.getContentText());
  }
}