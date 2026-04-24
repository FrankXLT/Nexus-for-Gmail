/**
 * NEXUS FOR GMAIL - BRANDING
 * Handles dynamic label coloring using the Brandfetch API.
 */

/**
 * Fetches the primary brand color for a given domain from the Brandfetch API.
 * Returns null if the domain is not found or API times out.
 */
function fetchBrandColor(domain) {
  try {
    if (!CONFIG.ENABLE_BRANDING || !SECRETS.BRANDFETCH_API_KEY || SECRETS.BRANDFETCH_API_KEY === 'YOUR_BRANDFETCH_API_KEY') return null;

    const url = `https://api.brandfetch.io/v2/brands/domain/${encodeURIComponent(domain)}`;
    const options = {
      method: 'get',
      headers: {
        'Authorization': `Bearer ${SECRETS.BRANDFETCH_API_KEY}`
      },
      muteHttpExceptions: true,
      timeout: 5000 // Ensure we don't hang execution
    };
    
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      if (data && data.colors && data.colors.length > 0) {
        // Find the color with type "primary", or fallback to the first one
        const primaryColorObj = data.colors.find(c => c.type === 'primary') || data.colors[0];
        return primaryColorObj ? primaryColorObj.hex : null;
      }
    }
  } catch (e) {
    Logger.log("Brandfetch API Error: " + e.message);
  }
  return null;
}

/**
 * Helper to parse hex string into RGB object.
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Snaps a given hex color to the closest matching color in Gmail's valid background colors.
 * Uses Euclidean distance in RGB color space.
 */
function findClosestGmailColor(targetHex) {
  const targetRgb = hexToRgb(targetHex);
  if (!targetRgb) return "#ffffff"; // fallback
  
  let closestHex = "#ffffff";
  let minDistance = Infinity;
  
  for (const hex of CONFIG.BACKGROUND_COLORS) {
    const rgb = hexToRgb(hex);
    if (!rgb) continue;
    
    // Calculate Euclidean distance between the target RGB and Gmail's RGB
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
 * Determines whether white or black text provides better contrast against a background.
 * Uses the WCAG relative luminance formula.
 */
function getAccessibleTextColor(bgHex) {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return "#000000"; // fallback
  
  // Calculate relative luminance
  const a = [rgb.r, rgb.g, rgb.b].map(function (v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  
  const luminance = a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  
  // Return a valid Gmail light or dark text hex color
  // Luminance > 0.179 implies a light background, so use dark text.
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

/**
 * Orchestrates the fetching and patching of a label's color.
 */
function applyBrandColorToLabel(label, term) {
  if (!CONFIG.ENABLE_BRANDING) return;
  
  // Extrapolate a domain from the term (e.g., "Netflix" -> "netflix.com")
  if (!term) return;
  const domain = term.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() + '.com';
  
  const brandColorHex = fetchBrandColor(domain);
  if (!brandColorHex) return;
  
  const safeBgColor = findClosestGmailColor(brandColorHex);
  const safeTextColor = getAccessibleTextColor(safeBgColor);
  
  try {
    const labels = Gmail.Users.Labels.list('me').labels;
    const advancedLabel = labels.find(l => l.name === label.getName());
    if (advancedLabel) {
      Gmail.Users.Labels.patch({ color: { backgroundColor: safeBgColor, textColor: safeTextColor } }, 'me', advancedLabel.id);
    }
  } catch (e) {
    Logger.log("Failed to patch label color: " + e.message);
  }
}

/**
 * Daily scheduled task to scan for unbranded labels and apply Brandfetch colors.
 * Respects max_ops_per_day to avoid Google Quota exhaustion.
 */
function sweepUnbrandedLabels() {
  if (!CONFIG.ENABLE_BRANDING) return;
  
  const startTime = Date.now();
  const MAX_EXECUTION_TIME = 5.5 * 60 * 1000; // 5.5 minutes to avoid Google's 6-minute hard limit
  let opsCount = 0;
  // Use a sensible default or the configurable MAX_OPS_PER_DAY
  const maxOps = CONFIG.QUOTA_MANAGEMENT ? CONFIG.QUOTA_MANAGEMENT.MAX_OPS_PER_DAY : 1000;
  
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
           const brandHex = fetchBrandColor(domain);
           opsCount += 1;
           
           if (brandHex) {
             const safeBg = findClosestGmailColor(brandHex);
             const safeText = getAccessibleTextColor(safeBg);
             
             // Patch color - consumes 1 operation
             Gmail.Users.Labels.patch({ color: { backgroundColor: safeBg, textColor: safeText } }, 'me', label.id);
             opsCount += 1;
           }
        }
      }
    }
  } catch (e) {
    Logger.log("Sweep Error: " + e.message);
  }
}
