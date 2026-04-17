/**
 * NEXUS FOR GMAIL - CONFIGURATION
 * This acts as the "Control Panel" for Nexus. It holds all the variables, labels, 
 * and limits that dictate how the script behaves. By keeping these settings separate 
 * from the execution logic (Main.gs), non-technical users can customize the engine 
 * without needing to understand how to read or write JavaScript.

  ==========================================
  SUPPORTED GEMINI MODELS:
  Different models balance speed, cost, and "reasoning" capability.
  Copy and paste one of the strings below into the GEMINI_MODEL variable.
  
  -- Series 3 (Latest) --
  'gemini-3.1-pro-preview'
  'gemini-3.1-flash-lite-preview'
  'gemini-3.0-flash-preview'
  
  -- Series 2.5 (Stable) --
  'gemini-2.5-pro'
  'gemini-2.5-flash'
  'gemini-2.5-flash-lite'
  ==========================================
*/

const CONFIG = {
  // Nexus Version Tracker & Update Path
  VERSION: '1.2.0', 
  GITHUB_REPO: 'FrankXLT/Nexus-for-Gmail',
  
  // We default to flash-lite because it is the most cost-effective model for new users,
  // capable of processing thousands of emails for pennies.
  GEMINI_MODEL: 'gemini-2.5-flash-lite', 
  
  // Execution Settings
  // Determines how frequently Google's servers wake up to run the script.
  JOB_INTERVAL_MINUTES: 5, 
  
  // Debugging & Telemetry
  // When true, the script generates raw .txt files showing exactly what the AI returned.
  // Invaluable if the AI starts formatting its JSON incorrectly.
  DEBUG_MODE: true, 
  DEBUG_FOLDER_NAME: 'Debug Logs',
  
  // Gmail Label Triggers
  // The system uses these native Gmail labels to track an email's status in the pipeline.
  LABEL_READY: 'ai-ready',       // Apply this to emails you want processed
  LABEL_COMPLETE: 'ai-done',     // Applied successfully
  LABEL_FAILED: 'ai-failed',     // Applied if the AI crashes or returns bad data
  
  // Parent Folders for Sorting
  // These are the top-level directories Nexus will create in your Gmail sidebar.
  PARENT_LABEL_BUSINESS: 'Business',
  PARENT_LABEL_PEOPLE: 'People',
  PARENT_LABEL_FINANCIAL: 'Financial', 
  PARENT_LABEL_PURPOSE: 'Purpose', 
  
  // ==========================================
  // FLAG SENSITIVITY CONTROLS
  // Large Language Models (LLMs) can be overzealous. These rules dictate exactly 
  // how strict the AI should be when deciding to flag an email.
  // Uncomment the rule you want to actively use.
  // ==========================================
  FLAG_RULES: {
    // IMPORTANT FLAG (Yellow Chevron in Gmail)
    IMPORTANT: "Strict: ONLY true for urgent action items, unpaid bills, or legal notices.",
    // IMPORTANT: "Moderate: True for bills, legal notices, and personalized account alerts.",
    // IMPORTANT: "Lenient: True for anything that isn't marketing, forums, or social.",

    // STARRED FLAG (Yellow Star in Gmail)
    STARRED: "Strict: ONLY true for highly critical reference items like flight tickets or tax documents.",
    // STARRED: "Moderate: True for tracking numbers, final receipts, and event tickets.",
    // STARRED: "Lenient: True for any receipt, order confirmation, or shipping update."
  },
  
  // Pre-loaded Purpose categories to help new users get started without having to 
  // invent their own organizational structure from scratch.
  DEFAULT_PURPOSES: [
    'Accounts', 'Credit Reports', 'Support',
    'Memberships', 'News', 'Orders', 'Payments',
    'Personal', 'Registration', 'Shipping', 
    'Statements', 'Subscriptions'
  ],

  // BLACKLIST CONTROLS
  // Prevent the AI from categorizing or creating specific labels.
  BLACKLIST: {
    TERMS: ['Alerts', 'Spam', 'Unknown', 'Null', 'N/A', 'None'],
    
    // If true: The engine completely ignores the term if the AI suggests it.
    DO_NOT_USE: true, 
    
    // If true: The engine will use the term if you ALREADY have a label for it, 
    // but will NOT create a new Gmail label if it doesn't exist.
    DO_NOT_CREATE: true 
  },


  // Safety & Throttle Limits
  // MAX_EMAILS_PER_BATCH: Prevents the AI prompt from becoming too large and timing out.
  // MAX_BATCHES_PER_RUN: Prevents the script from exceeding Google's 6-minute execution limit.
  MAX_EMAILS_PER_BATCH: 10, 
  MAX_BATCHES_PER_RUN: 10,  
  
  // Google Drive Architecture
  // The master folder where logs and the system prompt are stored.
  MASTER_FOLDER_NAME: 'Nexus for Gmail', 
  
  // Advanced Gmail API Hex Palette
  // Google Apps Script natively only supports 16 basic colors. We use the Advanced 
  // REST API and this specific hex palette to access Gmail's modern pastel colors.
  PALETTE: {
    "Red": { bg: "#fb4c2f", text: "#ffffff" }, "Brick Red": { bg: "#e66550", text: "#ffffff" },
    "Soft Red": { bg: "#efa093", text: "#000000" }, "Pink": { bg: "#f691b3", text: "#000000" },
    "Soft Pink": { bg: "#fbc8d9", text: "#000000" }, "Peach": { bg: "#f6c5be", text: "#000000" },
    "Very Light Pink": { bg: "#fcdee8", text: "#000000" }, "Orange": { bg: "#ffad47", text: "#000000" },
    "Golden Orange": { bg: "#ffbc6b", text: "#000000" }, "Soft Orange": { bg: "#ffd6a2", text: "#000000" },
    "Light Orange": { bg: "#ffe6c7", text: "#000000" }, "Yellow": { bg: "#fad165", text: "#000000" },
    "Golden Yellow": { bg: "#fcda83", text: "#000000" }, "Soft Yellow": { bg: "#fce8b3", text: "#000000" },
    "Light Yellow": { bg: "#fef1d1", text: "#000000" }, "Green": { bg: "#16a766", text: "#ffffff" },
    "Light Green": { bg: "#43d692", text: "#000000" }, "Teal": { bg: "#89d3b2", text: "#000000" },
    "Light Teal": { bg: "#a0eac9", text: "#000000" }, "Mint": { bg: "#b9e4d0", text: "#000000" },
    "Light Mint": { bg: "#c6f3de", text: "#000000" }, "Blue": { bg: "#4a86e8", text: "#ffffff" },
    "Soft Blue": { bg: "#a4c2f4", text: "#000000" }, "Light Blue": { bg: "#c9daf8", text: "#000000" },
    "Purple": { bg: "#a479e2", text: "#ffffff" }, "Soft Purple": { bg: "#d0bcf1", text: "#000000" },
    "Light Purple": { bg: "#e4d7f5", text: "#000000" }, "Black": { bg: "#000000", text: "#ffffff" },
    "Dark Gray": { bg: "#434343", text: "#ffffff" }, "Medium Gray": { bg: "#666666", text: "#ffffff" },
    "Gray": { bg: "#999999", text: "#ffffff" }, "Light Gray": { bg: "#cccccc", text: "#000000" },
    "Very Light Gray": { bg: "#efefef", text: "#000000" }, "White": { bg: "#ffffff", text: "#000000" }
  }
};
