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
  // Combine the core system labels with the parent directories
  const coreLabels = [
    CONFIG.LABEL_READY, CONFIG.LABEL_COMPLETE, CONFIG.LABEL_FAILED,
    CONFIG.PARENT_LABEL_BUSINESS, CONFIG.PARENT_LABEL_PEOPLE,
    CONFIG.PARENT_LABEL_FINANCIAL, CONFIG.PARENT_LABEL_PURPOSE
  ];

  // Dynamically generate the nested Purpose paths (e.g., 'Purpose/Receipts')
  CONFIG.DEFAULT_PURPOSES.forEach(purpose => {
    coreLabels.push(`${CONFIG.PARENT_LABEL_PURPOSE}/${purpose}`);
  });

  let existingCount = 0; let createdCount = 0;
  
  // Loop through the list and create the labels. 
  // We wrap this in a try/catch block because Gmail's API can throw an error if a 
  // label already exists in the Trash, which would otherwise crash the entire setup.
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
- Entity Type: Determine if this correspondent is "Financial" (banks, lenders, credit cards), "Business" (companies, retail, services), or a "Person" (individual human).
- Pick a brand color from this list: [{{COLORS}}]. Default to "Gray".

Task 2: Email Specifics (Evaluate each EMAIL INDEX)
For each email, provide:
- index: The integer ID matching the EMAIL INDEX.
- purpose: Identify a specific reason (e.g., Order Update, Shipping Notice, Price Update, Receipt, Statement). Check list: [{{PURPOSES}}]. If you are unsure or it does not fit a clear category, return null.
- category: Must be exactly "Primary", "Promotions", "Social", "Updates", or "Forums".
- isImportant: Boolean ({{IMPORTANT_RULE}})
- isStarred: Boolean ({{STARRED_RULE}})

Return ONLY a raw JSON object. Do not include markdown blocks.
Format:
{
  "name": "Correspondent Name",
  "entityType": "Business", 
  "color": "Color",
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
{{PAYLOAD}}`;
}
