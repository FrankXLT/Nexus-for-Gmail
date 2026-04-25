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
  // =========================================================================
  // 1. CORE AI SETTINGS
  // =========================================================================
  
  // We default to flash-lite because it is the most cost-effective model for new users,
  // capable of processing thousands of emails for pennies.
  GEMINI_MODEL: 'gemini-2.5-flash-lite', 

  // =========================================================================
  // 2. GMAIL ORGANIZATION & LABELS
  // =========================================================================

  // Gmail Label Triggers
  // The system uses these native Gmail labels to track an email's status in the pipeline.
  LABEL_READY: 'ai/ready',       // Apply this to emails you want processed
  LABEL_COMPLETE: 'ai/done',     // Applied successfully
  LABEL_FAILED: 'ai/failed',     // Applied if the AI crashes or returns bad data
  
  // Parent Folders for Sorting
  // These are the top-level directories Nexus will create in your Gmail sidebar.
  PARENT_LABEL_PURPOSE: 'Purpose', 
  
  // Define your main parent folders and explain to the AI exactly what belongs in them.
  // Format: "Folder Name": "Description for the AI"
  ENTITIES: {
    "Financial": "Banks, lenders, credit cards, investment accounts, and tax entities.",
    "Business": "Corporate entities, B2B services, general newsletters, and professional organizations not fitting other categories.",
    "Shopping": "E-commerce platforms, retail department stores, grocery and specialty food vendors, and online marketplaces (e.g., Amazon, Walmart, Macy's, Wild Fork Foods).",
    "Education": "Establishments for education such as schools, school boards, colleges, and higher education.",
    "People": "Individual humans and personal contacts.",
    "Health": "Medical offices for doctors, hospitals, blood work, lab work, medical specialists, surgery, and mental health.",
    "Dining": "Restaurants, fast food, food delivery services, reservations, and dining receipts.",
    "Social Sites": "Social media platforms, dating apps, community forums, and networking sites.",
    "TV-Streaming": "Video streaming services, television networks, movie platforms, and subscriptions like Netflix or Hulu.",
    "News": "Newsletters, journalism, daily digests, and media publications.",
    "Utilities": "Internet, power, water, telecom providers, and essential home services.",
    "Productivity": "Task management, note-taking apps, cloud storage, and workspace collaboration tools and software.",
    "Gaming": "Video game stores, gaming platforms, server hosting, and game developer communications."
  },

  // Pre-loaded Purpose categories to help new users get started without having to 
  // invent their own organizational structure from scratch.
  DEFAULT_PURPOSES: [
    'Accounts', 'Support', 'Memberships', 'News', 'Orders', 'Payments',
    'Personal', 'Registration', 'Shipping', 'Statements', 'Subscriptions'
  ],

  // A strict allowlist for the programmatic validation gateway to prevent LLM hallucination
  APPROVED_PURPOSES: [
    'Accounts', 'Calendar', 'Credit Reports', 'Deposits', 'Discussions', 'Donations', 
    'Events', 'Membership', 'Newsletters','Orders', 'Payments', 'Personal', 'Receipts', 'Refunds', 'Registration', 
    'Returns', 'Service', 'Shipping', 'Statements', 'Subscriptions', 'Issues-Support'
  ],

  // =========================================================================
  // 3. RULES & FILTERS
  // =========================================================================

  // How strict the AI should be when deciding to flag an email.
  // Uncomment the rule you want to actively use.
  FLAG_RULES: {
    // IMPORTANT FLAG (Yellow Chevron in Gmail)
    // Focuses on actual user action required based on the email body, ignoring clickbait subjects.
    IMPORTANT: "Strict: ONLY true for direct action items, overdue bills, or critical account notices derived from the email BODY. Ignore sensationalized subject lines or marketing disguised as alerts.",
    // IMPORTANT: "Moderate: True for action items, upcoming bills, policy changes, and personalized alerts requiring the user's review.",
    // IMPORTANT: "Lenient: True for any informational alert or action item that isn't marketing, forums, or social.",

    // STARRED FLAG (Yellow Star in Gmail)
    // Focuses on active, back-and-forth communication rather than static receipts.
    STARRED: "Strict: ONLY true for active, ongoing back-and-forth conversations (replies/forwards) that are categorized as 'Updates'.",
    // STARRED: "Moderate: True for ongoing conversational threads, or highly critical reference items like flight tickets and tax documents.",
    // STARRED: "Lenient: True for any ongoing thread, receipt, order confirmation, or shipping update."
  },

  // AUTO-TAGGING CONTROLS
  // Automatically creates a native Gmail filter to tag incoming mail.
  AUTO_TAGGING: {
    ENABLED: true, 
    // Which native Gmail tabs should the filter ignore?
    EXCLUDE_CATEGORIES: ['Promotions', 'Social', 'Forums'] 
  },

  // BLACKLIST CONTROLS
  // Prevent the AI from categorizing or creating specific labels.
  BLACKLIST: {
    ENTITIES: ['Spam', 'Unknown', 'Null', 'N/A', 'None'],
    PURPOSES: ['Alerts', 'Alert', 'Spam', 'Unknown', 'Null', 'N/A', 'None', 'Shipping Notice', 'Updates', 'Update', 'Offers'],
    
    // If true: The engine completely ignores the term if the AI suggests it.
    DO_NOT_USE: true, 
    
    // If true: The engine will use the term if you ALREADY have a label for it, 
    // but will NOT create a new Gmail label if it doesn't exist.
    DO_NOT_CREATE: true 
  },

  // =========================================================================
  // 4. BRANDING & AESTHETICS
  // =========================================================================

  // Dynamic Label Coloring
  // Bypasses all external Betterbrand API calls if false.
  ENABLE_BRANDING: true,
  BRAND_FOLDER_NAME: "Brand Dictionaries", // Folder containing the .less files

  // =========================================================================
  // 5. SELF-TUNING ENGINE CONFIGURATION
  // =========================================================================
  
  ENABLE_SELF_TUNING: true, 
  CORRECTION_LABEL: "ai/correct", 
  CACHE_RETENTION_DAYS: 21, 
  CACHE_FOLDER_NAME: "Cache",

  // =========================================================================
  // 6. EXECUTION & LIMITS
  // =========================================================================

  // Execution Settings
  // Determines how frequently Google's servers wake up to run the script.
  JOB_INTERVAL_MINUTES: 5, 

  // QUOTA & BACKLOG MANAGEMENT
  // Protects your Google limits when processing massive email backlogs.
  QUOTA_MANAGEMENT: {
    // Emails received within this many hours bypass the throttle completely.
    FRESH_WINDOW_HOURS: 72, 
    
    // Maximum Gmail API operations allowed per 24 hours. Once hit, older emails are paused.
    // Google's absolute hard limit is 20,000. 14,000 leaves plenty of room for normal Gmail use.
    // This leaves 6000 ops for the user to interact with their inbox without hitting the limit (600 emails per 24 hours). Adjust based on your usage patterns.
    MAX_OPS_PER_DAY: 15000, 
    
    // Estimated operations per email processed (Fetching, bulk label modify, starring, etc.)
    OPS_PER_EMAIL: 3
  },
  
  // Safety & Throttle Limits
  // MAX_EMAILS_PER_BATCH: Prevents the AI prompt from becoming too large and timing out.
  // MAX_BATCHES_PER_RUN: Prevents the script from exceeding Google's 6-minute execution limit.
  MAX_EMAILS_PER_BATCH: 5, 
  MAX_BATCHES_PER_RUN: 20,  
  
  // =========================================================================
  // 7. SYSTEM & ADVANCED
  // =========================================================================

  // Nexus Version Tracker & Update Path
  VERSION: '2.6.0', 
  GITHUB_REPO: 'FrankXLT/Nexus-for-Gmail',

  // Google Drive Architecture
  // The master folder where logs and the system prompt are stored.
  MASTER_FOLDER_NAME: 'Nexus for Gmail', 

  // Debugging & Telemetry
  // When true, the script generates raw .txt files showing exactly what the AI returned.
  // Invaluable if the AI starts formatting its JSON incorrectly.
  DEBUG_MODE: true, 
  DEBUG_FOLDER_NAME: 'Debug Logs',

  // Advanced Gmail API Hex Colors
  // Google Apps Script natively only supports 16 basic colors. We use the Advanced 
  // REST API and this specific hex palette to access Gmail's modern pastel colors.
  BACKGROUND_COLORS: [
    "#000000", "#434343", "#666666", "#999999", "#cccccc", "#efefef", "#f3f3f3", "#ffffff",
    "#fb4c2f", "#ffad47", "#fad165", "#16a766", "#43d692", "#4a86e8", "#a479e2", "#f691b3",
    "#f6c5be", "#ffe6c7", "#fef1d1", "#b9e4d0", "#c6f3de", "#c9daf8", "#e4d7f5", "#fcdee8",
    "#efa093", "#ffd6a2", "#fce8b3", "#89d3b2", "#a0eac9", "#a4c2f4", "#d0bcf1", "#fbc8d9",
    "#e66550", "#ffbc6b", "#fcda83", "#44b984", "#68dfa9", "#6d9eeb", "#b694e8", "#f7a7c0",
    "#cc3a21", "#eaa041", "#f2c960", "#149e60", "#3dc789", "#3c78d8", "#8e63ce", "#e07798",
    "#ac2b16", "#cf8933", "#d5ae49", "#0b804b", "#2a9c68", "#285bac", "#653e9b", "#b65775",
    "#822111", "#a46a21", "#aa8831", "#076239", "#1a764d", "#1c4587", "#41236d", "#83334c"
  ],
  TEXT_COLORS: [
    "#000000", "#434343", "#666666", "#999999", "#cccccc", "#efefef", "#f3f3f3", "#ffffff",
    "#fb4c2f", "#ffad47", "#fad165", "#16a766", "#43d692", "#4a86e8", "#a479e2", "#f691b3",
    "#f6c5be", "#ffe6c7", "#fef1d1", "#b9e4d0", "#c6f3de", "#c9daf8", "#e4d7f5", "#fcdee8",
    "#efa093", "#ffd6a2", "#fce8b3", "#89d3b2", "#a0eac9", "#a4c2f4", "#d0bcf1", "#fbc8d9",
    "#e66550", "#ffbc6b", "#fcda83", "#44b984", "#68dfa9", "#6d9eeb", "#b694e8", "#f7a7c0",
    "#cc3a21", "#eaa041", "#f2c960", "#149e60", "#3dc789", "#3c78d8", "#8e63ce", "#e07798",
    "#ac2b16", "#cf8933", "#d5ae49", "#0b804b", "#2a9c68", "#285bac", "#653e9b", "#b65775",
    "#822111", "#a46a21", "#aa8831", "#076239", "#1a764d", "#1c4587", "#41236d", "#83334c"
  ]
};