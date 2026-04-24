/**
 * Purpose: Orchestrates the entire setup process for Nexus for Gmail.
 * Input: None
 * Output: Calls functions to create Drive folders, a Google Doc, Gmail labels, and automation triggers.
 * Importance: Acts as the 1-click installer so the user does not have to manually build the required scaffolding.
 */
function installNexus() {
  Logger.log("Starting Nexus for Gmail installation...");
  
  // Step 1: Build the Drive folders, Google Doc, and Gmail Labels
  initializeDriveSystem();
  
  // Step 2: Activate the background timer
  setupAutoRun();

  // Step 3: Install update check
  checkForUpdates(); 
  
  // Step 4: Install Auto Tag Filter
  setupAutoTagFilter(); 

  Logger.log("========================================");
  Logger.log("INSTALLATION COMPLETE! Nexus is now active.");
  Logger.log("========================================");
}

/**
 * Purpose: Creates the Drive infrastructure and generates the Prompt Document.
 * Input: None
 * Output: Modifies Drive to create folders/docs and UserProperties to save IDs.
 * Importance: Ensures the physical folders and documents required by the AI engine exist and their IDs are stored for future access.
 */
function initializeDriveSystem() {
  // Use DriveApp to search for existing folders before creating new ones.
  // This prevents the script from creating duplicates if the user runs the installer twice.
  let masterFolders = DriveApp.getFoldersByName(CONFIG.MASTER_FOLDER_NAME);
  let masterFolder = masterFolders.hasNext() ? masterFolders.next() : DriveApp.createFolder(CONFIG.MASTER_FOLDER_NAME);
  
  let logFolders = masterFolder.getFoldersByName("Logs");
  let logsFolder = logFolders.hasNext() ? logFolders.next() : masterFolder.createFolder("Logs");
  
  // Pre-build all the required labels in Gmail safely
  initializeLabels();
  
  // PropertiesService is a hidden key-value store for the script. 
  // We use it to permanently remember the internal ID of our Document and Log folder.
  const props = PropertiesService.getUserProperties();
  const existingDocId = props.getProperty('PROMPT_DOC_ID');
  
  if (existingDocId) {
    Logger.log("Drive system is already initialized. If you want to reset your prompt, run resetSystemPrompt().");
  } else {
    // DocumentApp creates the actual Google Doc that the AI will read its instructions from.
    const promptDoc = DocumentApp.create('System Prompt - Email AI');
    promptDoc.getBody().setText(getDefaultPromptTemplate());
    
    // Move the newly created Doc into the Master Folder we made earlier
    DriveApp.getFileById(promptDoc.getId()).moveTo(masterFolder);
    
    // Save the internal IDs for the main engine to use later
    props.setProperty('PROMPT_DOC_ID', promptDoc.getId());
    props.setProperty('LOGS_FOLDER_ID', logsFolder.getId());
    
    Logger.log("Drive system and Gmail labels initialized! Open your prompt here: " + promptDoc.getUrl());
  }
}

/**
 * Purpose: Silently builds all the necessary folders and sub-folders in the user's Gmail sidebar.
 * Input: None
 * Output: Modifies Gmail by creating required labels based on CONFIG.
 * Importance: Pre-builds labels safely so that the AI categorization process does not fail when assigning labels.
 */
function initializeLabels() {
  const coreLabels = [
    CONFIG.LABEL_READY, CONFIG.LABEL_COMPLETE, CONFIG.LABEL_FAILED,
    CONFIG.PARENT_LABEL_PURPOSE
  ];

  // Dynamically pull in the top-level entity folders
  Object.keys(CONFIG.ENTITIES).forEach(entity => coreLabels.push(entity));

  CONFIG.DEFAULT_PURPOSES.forEach(purpose => {
    coreLabels.push(`${CONFIG.PARENT_LABEL_PURPOSE}/${purpose}`);
  });

  let existingCount = 0; let createdCount = 0;
  coreLabels.forEach(labelName => {
    try {
      if (GmailApp.getUserLabelByName(labelName)) { 
        existingCount++; 
      } else { 
        GmailApp.createLabel(labelName); 
        createdCount++; 
      }
    } catch (e) {
      Logger.log(`Warning: Could not create label '${labelName}'. Error: ${e.message}`);
    }
  });
  Logger.log(`Label Check Complete: ${existingCount} already existed, ${createdCount} newly created.`);
}

/**
 * Purpose: Overwrites the Prompt Document with the factory defaults.
 * Input: None
 * Output: Modifies the Prompt Document content in Google Docs.
 * Importance: Acts as a utility for users to recover their prompt formatting if they accidentally break it.
 */
function resetSystemPrompt() {
  const props = PropertiesService.getUserProperties();
  const docId = props.getProperty('PROMPT_DOC_ID');
  
  if (!docId) {
    Logger.log("Error: System not initialized. Run installNexus() first.");
    return;
  }
  
  try {
    const promptDoc = DocumentApp.openById(docId);
    promptDoc.getBody().setText(getDefaultPromptTemplate());
    Logger.log("========================================");
    Logger.log("SUCCESS! System Prompt overwritten.");
    Logger.log("CLICK THIS LINK TO VIEW IT: " + promptDoc.getUrl());
    Logger.log("========================================");
  } catch (e) {
    Logger.log("Error resetting prompt: " + e.message);
  }
}

/**
 * Purpose: Sets up recurring triggers for various Nexus functions.
 * Input: None
 * Output: Creates new ScriptApp triggers and deletes old ones.
 * Importance: Enables automated background execution of the main pipeline and maintenance tasks without user intervention.
 */
function setupAutoRun() {
  const triggers = ScriptApp.getProjectTriggers();
  // Always delete existing triggers first to prevent creating duplicate schedules
  for (let i = 0; i < triggers.length; i++) { ScriptApp.deleteTrigger(triggers[i]); }
  
  // Create the new time-based trigger using the interval from Config.gs
  ScriptApp.newTrigger('mainPipeline').timeBased().everyMinutes(CONFIG.JOB_INTERVAL_MINUTES).create();
  ScriptApp.newTrigger('checkForUpdates').timeBased().everyDays(7).create(); 
  
  // --- V2.0.0 SELF-TUNING TRIGGERS ---
  ScriptApp.newTrigger('processCorrections').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('tuneSystemPrompt').timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger('updateLabelBrandingColors').timeBased().everyDays(1).atHour(3).create();
  // -----------------------------------

  // --- V2.2.3 BACKGROUND MIGRATION TRIGGER ---
  ScriptApp.newTrigger('migrateLabelsToEntities').timeBased().everyDays(1).atHour(4).create();

  // --- V2.3.0 DYNAMIC BRANDING TRIGGER ---
  ScriptApp.newTrigger('sweepUnbrandedLabels').timeBased().everyDays(1).atHour(5).create();

  Logger.log(`Automation trigger successfully activated. Nexus will run every ${CONFIG.JOB_INTERVAL_MINUTES} minutes.`);
}

/**
 * Purpose: Returns the core instruction template for the Gemini Model.
 * Input: None
 * Output: Returns a string containing the prompt template with {{DOUBLE_BRACKETS}} placeholders.
 * Importance: Provides the foundational instructions that tell the AI how to categorize emails, which are dynamically populated at runtime.
 */
function getDefaultPromptTemplate() {
  return `Analyze this batch of emails from the same sender domain.

Task 1: Global Domain Info
- Identify the Correspondent Name. Check existing list: [{{CORRESPONDENTS}}].
- Entity Type: Choose exactly ONE category from this list based on the correspondent:
{{ENTITIES}}
Task 2: Email Specifics (Evaluate each EMAIL INDEX)
For each email, provide:
- index: The integer ID matching the EMAIL INDEX.
- purpose: Identify a specific reason (e.g., Order Update, Shipping Notice, Price Update, Receipt, Statement). MUST strictly check existing list: [{{PURPOSES}}] and reuse existing matching purposes. 
CRITICAL TAXONOMY RULES:
  - NEVER use plurals for these categories. Force consolidation: 'Payments' -> 'Payment', 'Statements' -> 'Statement', 'Credit Reports' -> 'Credit Report'.
  - Route all Calendar invites/accepts strictly to 'Calendar'.
  - 'Event Notice' must be mapped directly to 'Events'.
  - NEVER use 'Support'. Map to 'Issues-Support'.
  - If you are unsure or it does not fit a clear category, return null.
- category: Must be exactly "Primary", "Promotions", "Social", "Updates", or "Forums". CRITICAL RULE: If the entityType is "People" and this is a conversational email, strongly favor "Primary" over "Updates".
- isImportant: Boolean ({{IMPORTANT_RULE}}). ALWAYS set to true for "Alerts", do NOT use "Alert" or "Alerts" as a purpose.
- isStarred: Boolean ({{STARRED_RULE}})

Return ONLY a raw JSON object. Do not include markdown blocks.
Format:
{
  "name": "Correspondent Name",
  "entityType": "Business", 
  "emails": [
    {
      "index": 0,
      "purpose": "Order Update",
      "category": "Updates",
      "isImportant": false,
      "isStarred": false
    }
  ]
}

Sender Domain: {{DOMAIN}}
{{PAYLOAD}}

[START_AUTOTUNED_RULES]
1. No autotuned rules generated yet.
[END_AUTOTUNED_RULES]`;
}

/**
 * Purpose: Checks the public GitHub repository for a new release.
 * Input: None
 * Output: Sends an email notification if a newer version is found.
 * Importance: Keeps the user informed about new updates automatically.
 */
function checkForUpdates() {
  if (!CONFIG.GITHUB_REPO || !SECRETS.NOTIFICATION_EMAIL || SECRETS.NOTIFICATION_EMAIL === 'your-email@gmail.com') return;

  try {
    const url = `https://api.github.com/repos/${CONFIG.GITHUB_REPO}/releases/latest`;
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    
    if (response.getResponseCode() === 200) {
      const releaseData = JSON.parse(response.getContentText());
      const latestVersion = releaseData.tag_name.replace(/^v/, ''); 
      const currentVersion = CONFIG.VERSION.replace(/^v/, '');
      
      if (isNewerVersion(latestVersion, currentVersion)) {
        const subject = `🚀 Nexus for Gmail Update Available! (v${latestVersion})`;
        const body = `Great news!\n\nA new version of Nexus for Gmail (v${latestVersion}) has been released on GitHub.\nYou are currently running v${currentVersion}.\n\nCheck out the release notes and update your code here:\n${releaseData.html_url}\n\nStay organized,\nThe Nexus Engine`;
        
        GmailApp.sendEmail(SECRETS.NOTIFICATION_EMAIL, subject, body);
      }
    }
  } catch (e) {
    Logger.log("Update check failed: " + e.toString());
  }
}

/**
 * Purpose: Compares semantic version strings to determine if a newer version is available.
 * Input: latest (String), current (String)
 * Output: Returns a boolean indicating if the latest version is greater than the current version.
 * Importance: Ensures updates are correctly identified based on version numbers.
 */
function isNewerVersion(latest, current) {
  const lParts = latest.split('.').map(Number);
  const cParts = current.split('.').map(Number);
  for (let i = 0; i < lParts.length; i++) {
    if (lParts[i] > (cParts[i] || 0)) return true;
    if (lParts[i] < (cParts[i] || 0)) return false;
  }
  return false;
}

/**
 * Purpose: Uses the Advanced Gmail API to create a native Gmail filter for auto-tagging.
 * Input: None
 * Output: Creates a filter in Gmail settings to automatically apply the ready label to incoming emails.
 * Importance: Guarantees emails are tagged with ai-ready the millisecond they arrive.
 */
function setupAutoTagFilter() {
  if (!CONFIG.AUTO_TAGGING || !CONFIG.AUTO_TAGGING.ENABLED) return;
  
  // We must get the system ID of the ai-ready label to attach it to a filter
  const labels = Gmail.Users.Labels.list('me').labels;
  const readyLabel = labels.find(l => l.name === CONFIG.LABEL_READY);
  
  if (!readyLabel) {
    Logger.log("Error: Ready label not found. Run initializeLabels first.");
    return;
  }

  // Check if we already built this filter so we don't create duplicates
  const existingFilters = Gmail.Users.Settings.Filters.list('me').filter || [];
  const hasExisting = existingFilters.some(f => 
    f.action && f.action.addLabelIds && f.action.addLabelIds.includes(readyLabel.id)
  );

  if (hasExisting) {
    Logger.log("Native Gmail auto-tag filter already exists. Skipping creation.");
    return;
  }

  // Build the native Gmail search syntax (e.g., "-category:promotions -category:social")
  let excludeQuery = "";
  if (CONFIG.AUTO_TAGGING.EXCLUDE_CATEGORIES && CONFIG.AUTO_TAGGING.EXCLUDE_CATEGORIES.length > 0) {
    excludeQuery = CONFIG.AUTO_TAGGING.EXCLUDE_CATEGORIES.map(c => `-category:${c.toLowerCase()}`).join(" ");
  }

  const newFilter = {
    criteria: { query: excludeQuery.trim() },
    action: { addLabelIds: [readyLabel.id] }
  };

  try {
    Gmail.Users.Settings.Filters.create(newFilter, 'me');
    Logger.log("Native Gmail auto-tag filter created successfully.");
  } catch (e) {
    Logger.log("Failed to create Gmail filter: " + e.message);
  }
}

/**
 * Purpose: Organization function to migrate and map existing Gmail labels into the new entity structure using AI.
 * Input: None
 * Output: Moves, renames, and groups existing labels to fall under defined entities or general purposes.
 * Importance: Helps users organize an existing messy label structure to fit the Nexus framework. Runs in the background to handle large backlogs.
 */
function migrateLabelsToEntities() {
  const startTime = Date.now();
  const maxExecutionTime = 5.5 * 60 * 1000; // 5.5 minutes

  const props = PropertiesService.getUserProperties();
  const logsFolderId = props.getProperty('LOGS_FOLDER_ID');
  let logText = `\n--- Migration Run: ${new Date().toISOString()} ---\n`;
  let threadsMigrated = 0;
  let earlyHalt = false;
  let haltReason = "";

  let quotaString = props.getProperty('QUOTA_DATA');
  let quotaData = quotaString ? JSON.parse(quotaString) : { windowStart: Date.now(), opsUsed: 0 };
  if (Date.now() - quotaData.windowStart > 86400000) {
      quotaData = { windowStart: Date.now(), opsUsed: 0 };
  }

  if (quotaData.opsUsed >= CONFIG.QUOTA_MANAGEMENT.MAX_OPS_PER_DAY) {
      logText += "Halted: Daily API quota already exhausted before start.\n";
      appendMigrationLog(logsFolderId, logText);
      return;
  }

  const allLabels = GmailApp.getUserLabels();
  const entityKeys = Object.keys(CONFIG.ENTITIES);
  
  let migratedStr = props.getProperty('MIGRATED_LABELS');
  let migratedLabels = migratedStr ? JSON.parse(migratedStr) : [];
  
  let mappingCacheStr = props.getProperty('MIGRATION_MAPPINGS');
  let mappingCache = mappingCacheStr ? JSON.parse(mappingCacheStr) : {};

  // Exclude standard entities, Purpose parent, Category labels, and already fully migrated labels
  const labelsToMap = allLabels
    .map(l => l.getName())
    .filter(name => !entityKeys.includes(name) && name !== CONFIG.PARENT_LABEL_PURPOSE && !name.startsWith('Category:') && !migratedLabels.includes(name));
  
  if (labelsToMap.length === 0) {
    logText += "No new labels to migrate.\n";
    appendMigrationLog(logsFolderId, logText);
    // Cleanup properties if we are fully done
    props.deleteProperty('MIGRATED_LABELS');
    props.deleteProperty('MIGRATION_MAPPINGS');
    return;
  }
  
  const apiKey = SECRETS.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
    logText += "Error: GEMINI_API_KEY is not set in secrets.gs.\n";
    appendMigrationLog(logsFolderId, logText);
    return;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;

  // Find labels that don't have a mapping yet
  let labelsWithoutMapping = labelsToMap.filter(name => !mappingCache.hasOwnProperty(name));

  // Batch labels into groups of 30 for AI categorization
  const BATCH_SIZE = 30;
  for (let b = 0; b < labelsWithoutMapping.length; b += BATCH_SIZE) {
    if (Date.now() - startTime > maxExecutionTime) { earlyHalt = true; haltReason = "Time Limit Reached"; break; }
    if (quotaData.opsUsed >= CONFIG.QUOTA_MANAGEMENT.MAX_OPS_PER_DAY) { earlyHalt = true; haltReason = "Quota Exhausted"; break; }

    const currentBatch = labelsWithoutMapping.slice(b, b + BATCH_SIZE);
    
    const prompt = `You are an expert organizer. Map the following user email labels to the best matching entity category OR the '${CONFIG.PARENT_LABEL_PURPOSE}' category.
If a label clearly represents a sender (like a business, person, bank) and fits into one of the entities, map it to that entity.
If a label is a topic, category, or reason (like 'Receipts', 'Travel', 'Orders', 'Events') and is a good fit for a general purpose, map it to '${CONFIG.PARENT_LABEL_PURPOSE}'.
If multiple labels represent the same entity or purpose, group them to the primary one by returning the same mapped name. Treat slight variations (e.g., missing "The", apostrophes, suffixes like "Inc", singular/plural differences like "Update" vs "Updates", or synonyms like "Event Notices" vs "Events", "Order Updates" vs "Orders", "Credit Reports" vs "Credit") as the same entity/purpose.
CRITICAL: If a label resolves to exactly 'Update' or 'Updates' (or its sublabel), map it to null as we only use the system Category for updates.
If a label is already a sublabel (e.g., 'Business/Facebook' or '${CONFIG.PARENT_LABEL_PURPOSE}/Orders') but belongs in a different entity or needs deduplication/renaming, map 'entity' to the new entity/Purpose and 'newName' to the base name ('Facebook' or 'Orders'). If it's already under the correct entity and named properly without duplicates, map it to null.

Available Entities:
${entityKeys.join(', ')}
Special:
${CONFIG.PARENT_LABEL_PURPOSE}

Labels to evaluate:
${currentBatch.join(', ')}

Return ONLY a raw JSON object mapping the original label name to an object with 'entity' and 'newName' (if merging or extracting base name, else same as original label name), or null if it shouldn't be moved.
Format:
{
  "Label1": { "entity": "Business", "newName": "Label1" },
  "Label2": null,
  "Business/Facebook": { "entity": "Social", "newName": "Facebook" },
  "Label3 (duplicate)": { "entity": "Business", "newName": "Label1" },
  "${CONFIG.PARENT_LABEL_PURPOSE}/Event Notices": { "entity": "${CONFIG.PARENT_LABEL_PURPOSE}", "newName": "Events" },
  "Update": null
}`;

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
      quotaData.opsUsed++; // API Call counts as an op
      const data = JSON.parse(response.getContentText());
      
      if (data.candidates && data.candidates.length > 0) {
        let text = data.candidates[0].content.parts[0].text;
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const mappings = JSON.parse(text);
        for (const oldName of currentBatch) {
           mappingCache[oldName] = mappings[oldName] !== undefined ? mappings[oldName] : null;
        }
      }
    } catch (e) {
      logText += `Failed fetching AI mappings: ${e.message}\n`;
      earlyHalt = true; haltReason = "AI API Error";
      break;
    }
  }

  // Process mapped labels using the cache
  for (const oldName of labelsToMap) {
    if (migratedLabels.includes(oldName)) continue;
    if (Date.now() - startTime > maxExecutionTime) { earlyHalt = true; haltReason = "Time Limit Reached"; break; }
    if (quotaData.opsUsed >= CONFIG.QUOTA_MANAGEMENT.MAX_OPS_PER_DAY) { earlyHalt = true; haltReason = "Quota Exhausted"; break; }

    if (!mappingCache.hasOwnProperty(oldName)) continue; // Not mapped by AI yet

    const mapping = mappingCache[oldName];
    if (mapping && mapping.entity && (entityKeys.includes(mapping.entity) || mapping.entity === CONFIG.PARENT_LABEL_PURPOSE)) {
      let baseName = mapping.newName || oldName;
      if (baseName.includes('/')) {
        baseName = baseName.split('/').pop();
      }
      const newPath = `${mapping.entity}/${baseName}`;
      
      // Skip if the new path is the exact same as the old name
      if (newPath === oldName) {
        migratedLabels.push(oldName);
        continue;
      }

      const oldLabel = GmailApp.getUserLabelByName(oldName);
      let newLabel = GmailApp.getUserLabelByName(newPath);
      if (!newLabel) {
         newLabel = GmailApp.createLabel(newPath);
         quotaData.opsUsed++;
         // Default color
         try {
            Gmail.Users.Labels.patch({ color: { backgroundColor: '#ffffff', textColor: '#000000' } }, 'me', Gmail.Users.Labels.list('me').labels.find(l => l.name === newPath).id);
            quotaData.opsUsed++;
         } catch (e) {}
      }
      
      if (oldLabel) {
        // Fetch in limited chunks to prevent memory overload and track progress
        const threads = oldLabel.getThreads(0, 100);
        if (threads.length === 0) {
            migratedLabels.push(oldName);
        } else {
            for (let i = 0; i < threads.length; i += 100) {
               if (Date.now() - startTime > maxExecutionTime) { earlyHalt = true; haltReason = "Time Limit Reached"; break; }
               if (quotaData.opsUsed >= CONFIG.QUOTA_MANAGEMENT.MAX_OPS_PER_DAY) { earlyHalt = true; haltReason = "Quota Exhausted"; break; }
               
               const batchThreads = threads.slice(i, i + 100);
               newLabel.addToThreads(batchThreads);
               oldLabel.removeFromThreads(batchThreads);
               quotaData.opsUsed += 2; 
               threadsMigrated += batchThreads.length;
            }
            // Check if all threads for this label are fully processed
            if (oldLabel.getThreads(0, 1).length === 0) {
                migratedLabels.push(oldName);
            }
        }
      } else {
        migratedLabels.push(oldName);
      }
    } else {
      // Mapped to null, do not process
      migratedLabels.push(oldName);
    }
  }

  logText += `Threads migrated this batch: ${threadsMigrated}\n`;
  if (earlyHalt) logText += `Halted early: ${haltReason}\n`;
  else if (threadsMigrated > 0 || labelsToMap.length > 0) logText += `Batch completed successfully.\n`;

  props.setProperty('QUOTA_DATA', JSON.stringify(quotaData));
  
  if (labelsToMap.filter(n => !migratedLabels.includes(n)).length === 0) {
    props.deleteProperty('MIGRATED_LABELS');
    props.deleteProperty('MIGRATION_MAPPINGS');
  } else {
    props.setProperty('MIGRATED_LABELS', JSON.stringify(migratedLabels));
    props.setProperty('MIGRATION_MAPPINGS', JSON.stringify(mappingCache));
  }
  
  appendMigrationLog(logsFolderId, logText);
}

/**
 * Purpose: Appends text to the background migration log file.
 * Input: logsFolderId (String), logText (String)
 * Output: Creates or updates a Migration_Log.txt file in Google Drive.
 * Importance: Provides a record of background processing for the user.
 */
function appendMigrationLog(logsFolderId, logText) {
  if (!logsFolderId) return;
  try {
    const folder = DriveApp.getFolderById(logsFolderId);
    const files = folder.getFilesByName("Migration_Log.txt");
    if (files.hasNext()) {
      let file = files.next();
      file.setContent(file.getBlob().getDataAsString() + logText);
    } else {
      folder.createFile("Migration_Log.txt", logText, MimeType.PLAIN_TEXT);
    }
  } catch(e) {
    Logger.log("Failed to write migration log: " + e.message);
  }
}

/**
 * Purpose: Resets all user label colors to the default black text on white background.
 * Input: None
 * Output: Modifies Gmail label colors via the Advanced Gmail API.
 * Importance: Provides a clean slate for users wanting to reset their branding colors.
 */
function resetAllLabelColors() {
  let allLabelsResponse;
  try {
    allLabelsResponse = Gmail.Users.Labels.list('me');
  } catch (e) {
    Logger.log("Advanced Gmail service might be unavailable: " + e.message);
    return;
  }
  const allLabels = allLabelsResponse.labels || [];
  
  let resetCount = 0;
  for (const label of allLabels) {
    if (label.type === 'user') {
      try {
        Gmail.Users.Labels.patch({ color: { backgroundColor: '#ffffff', textColor: '#000000' } }, 'me', label.id);
        resetCount++;
      } catch (e) {
        // Skip labels that can't be patched
      }
    }
  }
  Logger.log(`Successfully reset colors for ${resetCount} labels to black on white text.`);
}