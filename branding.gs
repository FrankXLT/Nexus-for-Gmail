/**
 * NEXUS FOR GMAIL - BRANDING
 * Handles dynamic label coloring using an Offline-First Drive architecture and Gemini failover.
 */

// ==========================================
// 1. DICTIONARY LOADING & PARSING (.less)
// ==========================================

/**
 * Loads the brand color dictionary from the most recent .less file in the designated Drive folder.
 * Designed to be called once per batch in mainPipeline to avoid Drive I/O limits.
 * @returns {object} Dictionary mapping normalized brand names to arrays of hex colors.
 */
function loadBrandDictionary() {
  const masterFolders = DriveApp.getFoldersByName(CONFIG.MASTER_FOLDER_NAME);
  if (!masterFolders.hasNext()) {
    Logger.log("Master folder not found. Please run installNexus().");
    return {};
  }
  
  const masterFolder = masterFolders.next();
  const brandFolders = masterFolder.getFoldersByName(CONFIG.BRAND_FOLDER_NAME);

  if (!brandFolders.hasNext()) {
    Logger.log("Brand Dictionaries folder not found in Master folder. Please run installNexus().");
    return {};
  }

  try {
    const folder = brandFolders.next();
    const files = folder.searchFiles("title contains '.less'");
    
    let latestFile = null;
    let maxDate = 0;
    
    while (files.hasNext()) {
      const file = files.next();
      const lastUpdated = file.getLastUpdated().getTime();
      if (lastUpdated > maxDate) {
        maxDate = lastUpdated;
        latestFile = file;
      }
    }
    
    if (!latestFile) {
      Logger.log("No .less file found in the designated branding folder.");
      return {};
    }
    
    const content = latestFile.getBlob().getDataAsString();
    return parseLessDictionary(content);
  } catch (e) {
    Logger.log("Error loading brand dictionary: " + e.message);
    return {};
  }
}

/**
 * Parses the .less content into a usable dictionary.
 * @param {string} content The raw text of the .less file.
 * @returns {object} { "brandname": ["#hex1", "#hex2"] }
 */
function parseLessDictionary(content) {
  const dictionary = {};
  
  const regex = /@bc-([a-zA-Z0-9-]+?)(?:-\d+)?:\s*(#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6}))\s*;/g;
  
  let match;
  while ((match = regex.exec(content)) !== null) {
    let rawBrand = match[1];
    let hex = match[2].toLowerCase();
    
    let brand = rawBrand.replace(/-/g, '').toLowerCase();
    
    if (!dictionary[brand]) {
      dictionary[brand] = [];
    }
    
    if (!dictionary[brand].includes(hex)) {
      dictionary[brand].push(hex);
    }
  }
  
  return dictionary;
}

// ==========================================
// 2. DOMAIN MATCHING & FAILOVER
// ==========================================

/**
 * Extracts a clean brand string from an email domain.
 * @param {string} domain e.g., "mail.americanredcross.org"
 * @returns {string} e.g., "americanredcross"
 */
function extractBrandFromDomain(domain) {
  if (!domain) return "";
  
  let clean = domain.toLowerCase();
  const parts = clean.split('.');
  
  let brandPart = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return brandPart.replace(/-/g, '');
}

/**
 * Fetches the brand colors from the local dictionary or falls back to Gemini.
 * @param {string} domain 
 * @param {object} dictionary 
 * @returns {object|null} { primary: hex, secondary: hex, provider: string }
 */
function fetchBrandColorsWithFailover(domain, dictionary) {
  const brand = extractBrandFromDomain(domain);
  
  if (dictionary && dictionary[brand] && dictionary[brand].length > 0) {
    return {
      primary: dictionary[brand][0],
      secondary: dictionary[brand].length > 1 ? dictionary[brand][1] : "#000000",
      provider: "LOCAL_LESS"
    };
  }
  
  Logger.log(`[Failover] Domain ${domain} (brand: ${brand}) not found in .less dictionary. Falling back to Gemini.`);
  return fetchGeminiBrandColor(domain);
}

/**
 * Safe fallback dictionary mapping simple colors to valid Gmail hex pairs.
 */
const GEMINI_SAFE_COLORS = {
  "red": { bg: "#cc3a21", text: "#ffffff" },
  "orange": { bg: "#ffad47", text: "#000000" },
  "yellow": { bg: "#fad165", text: "#000000" },
  "green": { bg: "#16a766", text: "#ffffff" },
  "blue": { bg: "#4a86e8", text: "#ffffff" },
  "purple": { bg: "#a479e2", text: "#ffffff" },
  "dark": { bg: "#434343", text: "#ffffff" },
  "light": { bg: "#f3f3f3", text: "#000000" }
};

/**
 * Fails over to Gemini to guess the brand color.
 * @param {string} domain
 */
function fetchGeminiBrandColor(domain) {
  if (!SECRETS.GEMINI_API_KEY || SECRETS.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') return null;

  const prompt = `You are a brand design assistant. What is the primary brand color for the company associated with the domain '${domain}'? You must reply with exactly one word from this list: Red, Orange, Yellow, Green, Blue, Purple, Dark, Light.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${SECRETS.GEMINI_API_KEY}`;
  const payload = {
    "contents": [{ "parts": [{ "text": prompt }] }],
    "generationConfig": { "temperature": 0.1, "maxOutputTokens": 10 }
  };
  
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(response.getContentText());
    if (data.candidates && data.candidates.length > 0) {
      let text = data.candidates[0].content.parts[0].text.trim().toLowerCase();
      text = text.replace(/[^a-z]/g, '');
      
      if (GEMINI_SAFE_COLORS[text]) {
        return {
          primary: GEMINI_SAFE_COLORS[text].bg,
          secondary: GEMINI_SAFE_COLORS[text].text,
          provider: "GEMINI_FAILOVER",
          skipSnapping: true // We already know these are 100% safe
        };
      }
    }
  } catch (e) {
    Logger.log("Gemini failover error: " + e.message);
  }
  return null;
}

// ==========================================
// 3. COLOR MATH & SNAPPING
// ==========================================

function hexToRgb(hex) {
  if (!hex) return null;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
}

function findClosestGmailColor(targetHex, paletteType = 'BACKGROUND_COLORS') {
  const targetRgb = hexToRgb(targetHex);
  if (!targetRgb) return "#ffffff";
  
  const palette = CONFIG[paletteType] || CONFIG.BACKGROUND_COLORS;
  let closestHex = "#ffffff";
  let minDistance = Infinity;
  
  for (const hex of palette) {
    const rgb = hexToRgb(hex);
    if (!rgb) continue;
    
    const rDiff = targetRgb.r - rgb.r;
    const gDiff = targetRgb.g - rgb.g;
    const bDiff = targetRgb.b - rgb.b;
    const distance = Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);
    
    if (distance < minDistance) {
      minDistance = distance;
      closestHex = hex;
    }
  }
  
  return closestHex;
}

function getLuminance(rgb) {
  const a = [rgb.r, rgb.g, rgb.b].map(function (v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function getContrastRatio(hex1, hex2) {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return 1;
  
  const l1 = getLuminance(rgb1);
  const l2 = getLuminance(rgb2);
  
  const brightest = Math.max(l1, l2);
  const darkest = Math.min(l1, l2);
  
  return (brightest + 0.05) / (darkest + 0.05);
}

function getAccessibleTextColor(bgHex, textHex) {
  const ratio = getContrastRatio(bgHex, textHex);
  if (ratio >= 4.5) {
    return textHex;
  }
  
  const bgRgb = hexToRgb(bgHex);
  if (!bgRgb) return "#000000";
  const bgLuminance = getLuminance(bgRgb);
  
  return bgLuminance > 0.179 ? "#000000" : "#ffffff";
}

// ==========================================
// 4. LABEL APPLICATION
// ==========================================

/**
 * Orchestrates the fetching and patching of a label's color.
 * Accepts the dictionary so it doesn't have to load it again.
 */
function applyBrandColorToLabel(label, term, dictionary) {
  if (!CONFIG.ENABLE_BRANDING) return;
  
  if (!term) return;
  const domain = term.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() + '.com';
  
  if (!dictionary) dictionary = loadBrandDictionary();

  const colors = fetchBrandColorsWithFailover(domain, dictionary);
  if (!colors) return;
  
  let safeBgColor, safeTextColor;
  
  if (colors.skipSnapping) {
    safeBgColor = colors.primary;
    safeTextColor = colors.secondary;
  } else {
    safeBgColor = findClosestGmailColor(colors.primary, 'BACKGROUND_COLORS');
    const snappedTextColor = findClosestGmailColor(colors.secondary, 'TEXT_COLORS');
    safeTextColor = getAccessibleTextColor(safeBgColor, snappedTextColor);
  }
  
  try {
    const labels = Gmail.Users.Labels.list('me').labels;
    const advancedLabel = labels.find(l => l.name === label.getName());
    if (advancedLabel) {
      Gmail.Users.Labels.patch({ color: { backgroundColor: safeBgColor, textColor: safeTextColor } }, 'me', advancedLabel.id);
      
      const state = typeof loadState === 'function' ? loadState() : { labels: {} };
      if (!state.labels) state.labels = {};
      if (!state.labels[advancedLabel.id]) {
        state.labels[advancedLabel.id] = { name: advancedLabel.name, createdAt: Date.now() };
      }
      state.labels[advancedLabel.id].color = { bg: safeBgColor, text: safeTextColor };
      state.labels[advancedLabel.id].provider = colors.provider;
      state.labels[advancedLabel.id].lastBrandedAt = Date.now();
      if (typeof saveState === 'function') saveState(state);
    }
  } catch (e) {
    Logger.log("Failed to patch label color: " + e.message);
  }
}

/**
 * Daily scheduled task to scan for unbranded labels and apply colors.
 */
function sweepUnbrandedLabels() {
  Logger.log("--- Starting sweepUnbrandedLabels ---");
  if (!CONFIG.ENABLE_BRANDING) {
    Logger.log("Branding is disabled in CONFIG. Exiting.");
    return;
  }
  
  const startTime = Date.now();
  const MAX_EXECUTION_TIME = 5.5 * 60 * 1000;
  let opsCount = 0;
  const maxOps = CONFIG.QUOTA_MANAGEMENT ? CONFIG.QUOTA_MANAGEMENT.MAX_OPS_PER_DAY : 1000;
  
  let state = {};
  try {
    if (typeof loadState === 'function') state = loadState();
  } catch (e) {
    Logger.log("Failed to load state.gs logic. Check if state.gs exists: " + e.message);
  }
  if (!state.labels) state.labels = {};
  let stateModified = false;
  
  const dictionary = loadBrandDictionary();
  
  try {
    const labelsResponse = Gmail.Users.Labels.list('me');
    if (!labelsResponse || !labelsResponse.labels) return;
    
    const labels = labelsResponse.labels;
    let processedCount = 0;

    for (const label of labels) {
      if (Date.now() - startTime > MAX_EXECUTION_TIME) break;
      if (opsCount >= maxOps) break;
      
      if (label.type === 'user') {
        const labelState = state.labels[label.id];
        if (labelState && labelState.provider === 'USER') continue; 

        const parts = label.name.split('/');
        const isEntitySublabel = parts.length === 2 && CONFIG.ENTITIES && Object.keys(CONFIG.ENTITIES).includes(parts[0]);
        const hasColor = label.color && label.color.backgroundColor && label.color.textColor;
        const isDefaultColor = hasColor && label.color.backgroundColor.toLowerCase() === "#ffffff" && label.color.textColor.toLowerCase() === "#000000";
        
        if (isEntitySublabel && (!hasColor || isDefaultColor)) {
           const baseTerm = parts[1];
           if (!baseTerm) continue;
           
           const domain = baseTerm.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() + '.com';
           
           const colors = fetchBrandColorsWithFailover(domain, dictionary);
           opsCount += 1;
           
           if (colors && colors.primary) {
             let safeBg, safeText;
             
             if (colors.skipSnapping) {
                 safeBg = colors.primary;
                 safeText = colors.secondary;
             } else {
                 safeBg = findClosestGmailColor(colors.primary, 'BACKGROUND_COLORS');
                 const snappedText = findClosestGmailColor(colors.secondary, 'TEXT_COLORS');
                 safeText = getAccessibleTextColor(safeBg, snappedText);
             }
             
             try {
               Gmail.Users.Labels.patch({ color: { backgroundColor: safeBg, textColor: safeText } }, 'me', label.id);
               opsCount += 1;
               processedCount++;
               
               if (!state.labels[label.id]) {
                 state.labels[label.id] = { name: label.name, createdAt: Date.now() };
               }
               state.labels[label.id].color = { bg: safeBg, text: safeText };
               state.labels[label.id].provider = colors.provider || 'UNKNOWN';
               state.labels[label.id].lastBrandedAt = Date.now();
               stateModified = true;
             } catch (patchErr) {}
           }
        }
      }
    }
  } catch (e) {
    Logger.log("Sweep Error: " + e.message);
  } finally {
    if (stateModified && typeof saveState === 'function') {
      try { saveState(state); } catch (saveErr) {}
    }
  }
}