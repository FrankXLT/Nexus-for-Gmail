/**
 * NEXUS FOR GMAIL - BRANDING
 * Handles dynamic label coloring using multiple branding APIs.
 */

/**
 * Checks if a provider is currently locked out due to rate limits.
 * @param {string} providerName - 'LOGODEV' or 'BRANDFETCH'
 * @returns {boolean} - true if locked out
 */
function isProviderLockedOut(providerName) {
  const props = PropertiesService.getUserProperties();
  const lockoutTimeStr = props.getProperty('LOCKOUT_' + providerName);
  if (lockoutTimeStr) {
    const lockoutTime = parseInt(lockoutTimeStr, 10);
    const now = Date.now();
    // 24 hours in milliseconds
    if (now - lockoutTime < 24 * 60 * 60 * 1000) {
      return true;
    } else {
      // Lockout expired, clean it up
      props.deleteProperty('LOCKOUT_' + providerName);
    }
  }
  return false;
}

/**
 * Sets a lockout timestamp for a provider.
 * @param {string} providerName 
 */
function setProviderLockout(providerName) {
  const props = PropertiesService.getUserProperties();
  props.setProperty('LOCKOUT_' + providerName, Date.now().toString());
  Logger.log(`[CIRCUIT BREAKER] Lockout activated for ${providerName} for 24 hours.`);
}

/**
 * Fetches the brand colors from Logo.dev
 * @param {string} domain
 * @returns {object|null} { primary: hex, secondary: hex }
 */
function fetchLogoDev(domain) {
  try {
    if (!SECRETS.LOGODEV_SECRET_KEY || SECRETS.LOGODEV_SECRET_KEY === 'YOUR_LOGODEV_SECRET_KEY') return null;

    // Using a typical logo.dev URL. Adjust if their endpoint format is different.
    const url = `https://api.logo.dev/api/v2/search?q=${encodeURIComponent(domain)}`;
    const options = {
      method: 'get',
      headers: {
        'Authorization': `Bearer ${SECRETS.LOGODEV_SECRET_KEY}`
      },
      muteHttpExceptions: true,
      timeout: 5000
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    
    if (code === 429) {
      setProviderLockout('LOGODEV');
      return null;
    }
    
    if (code === 200) {
      const data = JSON.parse(response.getContentText());
      let primary = "#ffffff";
      let secondary = "#000000";
      
      // Robust extraction for Logo.dev payload
      if (data && data.colors) {
         primary = data.colors.primary || primary;
         secondary = data.colors.secondary || secondary;
      } else if (Array.isArray(data) && data.length > 0 && data[0].colors) {
         primary = data[0].colors.primary || primary;
         secondary = data[0].colors.secondary || secondary;
      }
      
      return { primary: primary, secondary: secondary };
    }
  } catch (e) {
    Logger.log("Logo.dev API Error: " + e.message);
  }
  return null;
}

/**
 * Fetches the brand colors from Brandfetch
 * @param {string} domain
 * @returns {object|null} { primary: hex, secondary: hex }
 */
function fetchBrandfetch(domain) {
  try {
    if (!SECRETS.BRANDFETCH_API_KEY || SECRETS.BRANDFETCH_API_KEY === 'YOUR_BRANDFETCH_API_KEY') return null;

    const url = `https://api.brandfetch.io/v2/brands/domain/${encodeURIComponent(domain)}`;
    const options = {
      method: 'get',
      headers: {
        'Authorization': `Bearer ${SECRETS.BRANDFETCH_API_KEY}`
      },
      muteHttpExceptions: true,
      timeout: 5000
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    
    if (code === 429) {
      setProviderLockout('BRANDFETCH');
      return null;
    }
    
    if (code === 200) {
      const data = JSON.parse(response.getContentText());
      if (data && data.colors && data.colors.length > 0) {
        const primary = data.colors[0].hex;
        const secondary = data.colors.length > 1 ? data.colors[1].hex : "#000000";
        return { primary: primary, secondary: secondary };
      }
    }
  } catch (e) {
    Logger.log("Brandfetch API Error: " + e.message);
  }
  return null;
}

/**
 * Orchestrates fetching colors based on the provider priority array.
 */
function fetchBrandColorsWithFailover(domain) {
  const providers = CONFIG.BRANDING_PROVIDERS || ['LOGODEV', 'BRANDFETCH'];
  
  for (const provider of providers) {
    if (isProviderLockedOut(provider)) {
      continue;
    }
    
    let colors = null;
    if (provider === 'LOGODEV') {
      colors = fetchLogoDev(domain);
    } else if (provider === 'BRANDFETCH') {
      colors = fetchBrandfetch(domain);
    }
    
    if (colors && colors.primary) {
      return colors; // Successfully found colors
    }
  }
  return null;
}

/**
 * Helper to parse hex string into RGB object.
 */
function hexToRgb(hex) {
  if (!hex) return null;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Snaps a given hex color to the closest matching color in a given palette array.
 * Uses Euclidean distance in RGB color space.
 * @param {string} targetHex - Hex color to snap.
 * @param {string} paletteType - 'BACKGROUND_COLORS' or 'TEXT_COLORS' from CONFIG.
 */
function findClosestGmailColor(targetHex, paletteType = 'BACKGROUND_COLORS') {
  const targetRgb = hexToRgb(targetHex);
  if (!targetRgb) return "#ffffff"; // fallback
  
  const palette = CONFIG[paletteType] || CONFIG.BACKGROUND_COLORS;
  let closestHex = "#ffffff";
  let minDistance = Infinity;
  
  for (const hex of palette) {
    const rgb = hexToRgb(hex);
    if (!rgb) continue;
    
    // Euclidean distance for RGB math
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

/**
 * Calculates the relative luminance of an RGB color based on WCAG standard.
 */
function getLuminance(rgb) {
  const a = [rgb.r, rgb.g, rgb.b].map(function (v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

/**
 * Calculates the contrast ratio between two hex colors.
 */
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

/**
 * Applies contrast override based on WCAG math.
 * If contrast between bg and text is too low, overrides text color.
 */
function getAccessibleTextColor(bgHex, textHex) {
  const ratio = getContrastRatio(bgHex, textHex);
  // WCAG standard minimum for normal text is 4.5:1
  if (ratio >= 4.5) {
    return textHex; // Contrast is acceptable
  }
  
  // Contrast too low, calculate a high-contrast safe default
  const bgRgb = hexToRgb(bgHex);
  if (!bgRgb) return "#000000";
  const bgLuminance = getLuminance(bgRgb);
  
  // If background is light (luminance > 0.179), use dark charcoal text, else pure white text
  return bgLuminance > 0.179 ? "#000000" : "#ffffff";
}

/**
 * Orchestrates the fetching and patching of a label's color.
 */
function applyBrandColorToLabel(label, term) {
  if (!CONFIG.ENABLE_BRANDING) return;
  
  if (!term) return;
  const domain = term.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() + '.com';
  
  const colors = fetchBrandColorsWithFailover(domain);
  if (!colors) return;
  
  // Dual-Snapping Math:
  // 1. Snap Primary API color to Gmail Background Color
  // 2. Snap Secondary API color to Gmail Text Color
  const safeBgColor = findClosestGmailColor(colors.primary, 'BACKGROUND_COLORS');
  const snappedTextColor = findClosestGmailColor(colors.secondary, 'TEXT_COLORS');
  
  // 3. Contrast Override
  const safeTextColor = getAccessibleTextColor(safeBgColor, snappedTextColor);
  
  try {
    const labels = Gmail.Users.Labels.list('me').labels;
    const advancedLabel = labels.find(l => l.name === label.getName());
    if (advancedLabel) {
      Gmail.Users.Labels.patch({ color: { backgroundColor: safeBgColor, textColor: safeTextColor } }, 'me', advancedLabel.id);
      
      // --- STATE MANAGER HOOK ---
      const state = loadState();
      if (!state.labels) state.labels = {};
      if (!state.labels[advancedLabel.id]) {
        state.labels[advancedLabel.id] = { name: advancedLabel.name, createdAt: Date.now() };
      }
      state.labels[advancedLabel.id].color = { bg: safeBgColor, text: safeTextColor };
      state.labels[advancedLabel.id].provider = colors.provider;
      state.labels[advancedLabel.id].lastBrandedAt = Date.now();
      saveState(state);
    }
  } catch (e) {
    Logger.log("Failed to patch label color: " + e.message);
  }
}

/**
 * Daily scheduled task to scan for unbranded labels and apply colors.
 * Respects max_ops_per_day to avoid Google Quota exhaustion.
 */
function sweepUnbrandedLabels() {
  if (!CONFIG.ENABLE_BRANDING) return;
  
  const startTime = Date.now();
  const MAX_EXECUTION_TIME = 5.5 * 60 * 1000; // 5.5 minutes to avoid Google's 6-minute hard limit
  let opsCount = 0;
  const maxOps = CONFIG.QUOTA_MANAGEMENT ? CONFIG.QUOTA_MANAGEMENT.MAX_OPS_PER_DAY : 1000;
  
  // --- STATE MANAGER HOOK ---
  const state = loadState();
  if (!state.labels) state.labels = {};
  let stateModified = false;
  
  try {
    const labelsResponse = Gmail.Users.Labels.list('me');
    if (!labelsResponse || !labelsResponse.labels) return;
    
    const labels = labelsResponse.labels;
    
    for (const label of labels) {
      if (Date.now() - startTime > MAX_EXECUTION_TIME) {
        Logger.log("Execution time limit reached during sweep. Pausing until next run.");
        break;
      }
      if (opsCount >= maxOps) {
        Logger.log("Max ops reached during sweep. Pausing until next run.");
        break;
      }
      
      // Look for user-created labels without custom colors
      if (label.type === 'user') {
        const labelState = state.labels[label.id];
        if (labelState && labelState.provider === 'USER') {
          continue; // Skip labels explicitly branded by the user
        }

        const parts = label.name.split('/');
        // Must be a direct sublabel of a configured entity
        const isEntitySublabel = parts.length === 2 && Object.keys(CONFIG.ENTITIES).includes(parts[0]);
        
        const hasColor = label.color && label.color.backgroundColor && label.color.textColor;
        const isDefaultColor = label.color && label.color.backgroundColor === "#ffffff" && label.color.textColor === "#000000";
        
        if (isEntitySublabel && (!hasColor || isDefaultColor)) {
           // Extract the term from the label path (e.g., "Business/Netflix" -> "Netflix")
           const baseTerm = parts[1];
           
           if (!baseTerm) continue;
           
           const domain = baseTerm.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() + '.com';
           
           // Fetch color - consumes 1 operation
           const colors = fetchBrandColorsWithFailover(domain);
           opsCount += 1;
           
           if (colors && colors.primary) {
             const safeBg = findClosestGmailColor(colors.primary, 'BACKGROUND_COLORS');
             const snappedText = findClosestGmailColor(colors.secondary, 'TEXT_COLORS');
             const safeText = getAccessibleTextColor(safeBg, snappedText);
             
             // Patch color - consumes 1 operation
             Gmail.Users.Labels.patch({ color: { backgroundColor: safeBg, textColor: safeText } }, 'me', label.id);
             opsCount += 1;
             
             // Update JSON State
             if (!state.labels[label.id]) {
               state.labels[label.id] = { name: label.name, createdAt: Date.now() };
             }
             state.labels[label.id].color = { bg: safeBg, text: safeText };
             state.labels[label.id].provider = colors.provider;
             state.labels[label.id].lastBrandedAt = Date.now();
             stateModified = true;
           }
        }
      }
    }
  } catch (e) {
    Logger.log("Sweep Error: " + e.message);
  } finally {
    if (stateModified) {
      saveState(state);
    }
  }
}