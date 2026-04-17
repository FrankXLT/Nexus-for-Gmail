/**
 * NEXUS FOR GMAIL - CONFIGURATION
 * * WHY THIS FILE EXISTS:
 * This acts as the "Control Panel" for Nexus. It holds all the variables, labels, 
 * rules, and limits that dictate how the script behaves. By keeping these settings separate 
 * from the execution logic, you can customize the engine without writing JavaScript.
 */

const CONFIG = {
  // Nexus Version Tracker & Update Path
  // The engine uses this to check GitHub daily to see if you are running the latest code.
  VERSION: '1.4.0', 
  GITHUB_REPO: 'FrankXLT/Nexus-for-Gmail', 
  
  // We default to flash-lite because it is the most cost-effective model,
  // capable of processing thousands of emails for pennies.
  GEMINI_MODEL: 'gemini-2.5-flash-lite', 
  
  // Execution Settings
  // Determines how frequently Google's servers wake up to process your ai-ready queue.
  JOB_INTERVAL_MINUTES: 5, 
  
  // Debugging & Telemetry
  // When true, the script generates raw .txt files showing exactly what the AI returned.
  // Invaluable if the AI starts formatting its JSON incorrectly.
  DEBUG_MODE: true, 
  DEBUG_FOLDER_NAME: 'Debug Logs',
  
  // Gmail Label Triggers
  // The system uses these native Gmail labels to track an email's status in the pipeline.
  LABEL_READY: 'ai-ready',       
  LABEL_COMPLETE: 'ai-done',     
  LABEL_FAILED: 'ai-failed',     
  
  // The master folder where nested Purpose labels (like Purpose/Receipts) will live.
  PARENT_LABEL_PURPOSE: 'Purpose', 

  // ==========================================
  // TOP-LEVEL ENTITY DIRECTORY
  // Define your main parent folders and explain to the AI exactly what belongs in them.
  // The engine dynamically reads this list, so you can add "Government" or "Healthcare" 
  // simply by adding a new line below.
  // Format: "Folder Name": "Description for the AI"
  // ==========================================
  ENTITIES: {
    "Financial": "Banks, lenders, credit cards, investment accounts, and tax entities.",
    "Business": "Companies, retail stores, services, newsletters, and organizations.",
    "Education": "Establishments for education such as schools, school boards, colleges, and higher education.",
    "People": "Individual humans and personal contacts.",
    "Health":"Medical offices for doctors, hospitals, blood work, lab work, medical specialists, surgery, and mental health."
  },

  // Pre-loaded Purpose categories to help organize specific types of emails.
  DEFAULT_PURPOSES: [
    'Accounts', 'Credit Reports', 'Support',
    'Memberships', 'News', 'Orders', 'Payments',
    'Personal', 'Registration', 'Shipping', 
    'Statements', 'Subscriptions' 
  ],

  // ==========================================
  // BLACKLIST CONTROLS
  // Prevent the AI from categorizing or creating specific labels.
  // ==========================================
  BLACKLIST: {
    TERMS: ['Alerts', 'Spam', 'Unknown', 'Null', 'N/A', 'None'],
    // If true: The engine completely ignores the term if the AI suggests it.
    DO_NOT_USE: true, 
    // If true: The engine will use the term if you ALREADY have a label for it, 
    // but will NOT create a new Gmail label if it doesn't exist.
    DO_NOT_CREATE: true 
  },

  // ==========================================
  // AUTO-TAGGING CONTROLS
  // Automatically creates a native Gmail filter to tag incoming mail the millisecond it arrives.
  // ==========================================
  AUTO_TAGGING: {
    ENABLED: true, 
    // Which native Gmail tabs should the filter completely ignore?
    EXCLUDE_CATEGORIES: ['Promotions', 'Social', 'Forums'] 
  },

  // ==========================================
  // FLAG SENSITIVITY CONTROLS
  // These rules dictate exactly how strict the AI should be when flagging an email.
  // ==========================================
  FLAG_RULES: {
    // IMPORTANT FLAG (Yellow Chevron in Gmail)
    IMPORTANT: "Strict: ONLY true for direct action items, overdue bills, or critical account notices derived from the email BODY. Ignore sensationalized subject lines or marketing disguised as alerts.",
    // STARRED FLAG (Yellow Star in Gmail)
    STARRED: "Strict: ONLY true for active, ongoing back-and-forth conversations (replies/forwards) that are categorized as 'Updates'."
  },
  
  // Safety & Throttle Limits
  // Prevents the AI prompt from becoming too large and crashing Google's execution time limits.
  MAX_EMAILS_PER_BATCH: 10, 
  MAX_BATCHES_PER_RUN: 10,  
  
  // Google Drive Architecture
  MASTER_FOLDER_NAME: 'Email Classification Engine', 
  
  // Advanced Gmail API Hex Palette for coloring folders
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
