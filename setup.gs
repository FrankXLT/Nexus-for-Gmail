/**
 * NEXUS FOR GMAIL - SETUP & INITIALIZATION
 * Before the engine can run, it needs physical folders in Google Drive to store its logs, 
 * labels in Gmail to organize the emails, and a Document to act as its "brain." 
 * This file handles all of that scaffolding automatically so the user doesn't have to.
 
 * 1-CLICK INSTALLER
 * The only function the user actually needs to run manually. It orchestrates the entire setup.
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
 * Creates the Drive infrastructure and generates the Prompt Document.
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
 * Silently builds all the necessary folders and sub-folders in the user's Gmail sidebar.
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
 * Utility function to let users overwrite their Prompt Document with the factory defaults
 * if they accidentally break the formatting in Google Docs.
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
 * Tells Google's servers to automatically execute the `mainPipeline` function
 * on a recurring schedule without the user needing to have their computer turned on.
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
  // -----------------------------------

  Logger.log(`Automation trigger successfully activated. Nexus will run every ${CONFIG.JOB_INTERVAL_MINUTES} minutes.`);
}

/**
 * The core instructions for the Gemini Model.
 * Notice the {{DOUBLE_BRACKETS}}. The main engine will search for these tags and 
 * dynamically inject real data (like the specific sensitivity rules) right before 
 * sending it to the AI.
 */
function getDefaultPromptTemplate() {
  return `Analyze this batch of emails from the same sender domain.

Task 1: Global Domain Info
- Identify the Correspondent Name. Check existing list: [{{CORRESPONDENTS}}].
- Entity Type: Choose exactly ONE category from this list based on the correspondent:
{{ENTITIES}}
- Identify the branding color, a primary and secondary color, of the entity that sent the email.
- Pick the closest matching background color from this list for the primary color: [{{BG_COLORS}}]. Default to "#ffffff".
- Pick the closest matching text color from this list for the secondary color: [{{TEXT_COLORS}}]. Default to "#000000".

Task 2: Email Specifics (Evaluate each EMAIL INDEX)
For each email, provide:
- index: The integer ID matching the EMAIL INDEX.
- purpose: Identify a specific reason (e.g., Order Update, Shipping Notice, Price Update, Receipt, Statement). Check list: [{{PURPOSES}}]. If you are unsure or it does not fit a clear category, return null.
- category: Must be exactly "Primary", "Promotions", "Social", "Updates", or "Forums". CRITICAL RULE: If the entityType is "People" and this is a conversational email, strongly favor "Primary" over "Updates".
- isImportant: Boolean ({{IMPORTANT_RULE}})
- isStarred: Boolean ({{STARRED_RULE}})

Return ONLY a raw JSON object. Do not include markdown blocks.
Format:
{
  "name": "Correspondent Name",
  "entityType": "Business", 
  "backgroundColor": "#ffffff",
  "textColor": "#000000",
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
 * Checks the public GitHub repository for a new release.
 * Triggered automatically once a day via setupAutoRun.
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
 * Compares semantic versions (e.g., determines that 1.1.0 > 1.0.9).
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
 * Uses the Advanced Gmail API to create a native Gmail filter.
 * This guarantees emails are tagged with ai-ready the millisecond they arrive.
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