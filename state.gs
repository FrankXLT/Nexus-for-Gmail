/**
 * NEXUS FOR GMAIL - STATE MANAGER
 * Handles persistent state for labels and their metadata.
 */

/**
 * Gets the state file, creating it if it doesn't exist.
 * @returns {GoogleAppsScript.Drive.File|null}
 */
function getStateFile() {
  const props = PropertiesService.getUserProperties();
  const logsFolderId = props.getProperty('LOGS_FOLDER_ID');
  
  if (!logsFolderId) {
    Logger.log("State Manager Error: LOGS_FOLDER_ID not found.");
    return null;
  }
  
  try {
    const logsFolder = DriveApp.getFolderById(logsFolderId);
    const masterFolder = logsFolder.getParents().next();
    const files = masterFolder.getFilesByName('nexus_state.json');
    
    if (files.hasNext()) {
      return files.next();
    } else {
      const initialState = { metadata: { lastSync: 0 }, labels: {} };
      return masterFolder.createFile('nexus_state.json', JSON.stringify(initialState), MimeType.PLAIN_TEXT);
    }
  } catch (e) {
    Logger.log("State Manager Error fetching state file: " + e.message);
    return null;
  }
}

/**
 * Loads the current state from Drive.
 * @returns {object} The state object.
 */
function loadState() {
  const file = getStateFile();
  if (!file) return { metadata: { lastSync: 0 }, labels: {} };
  
  try {
    const content = file.getBlob().getDataAsString();
    return JSON.parse(content);
  } catch (e) {
    Logger.log("Error parsing state file: " + e.message);
    return { metadata: { lastSync: 0 }, labels: {} };
  }
}

/**
 * Saves the state object back to Drive.
 * Handles potential Drive API write-locks gracefully using exponential backoff.
 * @param {object} stateObj 
 */
function saveState(stateObj) {
  const file = getStateFile();
  if (!file) return;
  
  let retries = 3;
  while (retries > 0) {
    try {
      file.setContent(JSON.stringify(stateObj, null, 2));
      return;
    } catch (e) {
      retries--;
      if (retries === 0) {
        Logger.log("Failed to save state after retries: " + e.message);
      } else {
        Utilities.sleep(Math.pow(2, 3 - retries) * 1000); // Exponential backoff
      }
    }
  }
}

/**
 * Performs a brute pull to update the state file with current Gmail labels.
 */
function syncLabelState() {
  Logger.log("Starting State Sync...");
  const state = loadState();
  if (!state.labels) state.labels = {};
  
  let liveLabelsResponse;
  try {
    liveLabelsResponse = Gmail.Users.Labels.list('me');
  } catch (e) {
    Logger.log("Error fetching Gmail labels during sync: " + e.message);
    return;
  }
  
  const liveLabels = liveLabelsResponse.labels || [];
  const liveLabelIds = new Set();
  
  const now = Date.now();
  
  for (const label of liveLabels) {
    if (label.type !== 'user') continue; // Only track user labels
    
    liveLabelIds.add(label.id);
    
    if (!state.labels[label.id]) {
      // Label exists in Gmail but NOT in JSON
      let bgColor = "#ffffff";
      let textColor = "#000000";
      if (label.color) {
        bgColor = label.color.backgroundColor || bgColor;
        textColor = label.color.textColor || textColor;
      }
      
      state.labels[label.id] = {
        name: label.name,
        createdAt: now,
        color: { bg: bgColor, text: textColor },
        provider: "DEFAULT",
        lastBrandedAt: 0
      };
    } else {
      // Label exists in both, update name just in case the user renamed it
      state.labels[label.id].name = label.name;
    }
  }
  
  // If a label exists in the JSON but NOT in Gmail: Delete it from the JSON.
  for (const id in state.labels) {
    if (!liveLabelIds.has(id)) {
      delete state.labels[id];
    }
  }
  
  if (!state.metadata) state.metadata = {};
  state.metadata.lastSync = now;
  
  saveState(state);
  Logger.log("State Sync Complete.");
}
