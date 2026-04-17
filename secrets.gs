/**
 * NEXUS FOR GMAIL - SECRETS
 * * WHY THIS FILE EXISTS:
 * In software development, you never want to hardcode passwords or API keys directly 
 * into the main logic of your application, especially if you plan to share the code 
 * on platforms like GitHub. By isolating the API key here, users can easily add their 
 * credentials without accidentally breaking the core engine.
 */

const SECRETS = {
  // The unique identifier that authorizes this script to talk to Google's AI servers.
  // Generate a free key at: https://aistudio.google.com/
  GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY',
  
  // The email address where the system will send notifications when a new version
  // of Nexus is released on GitHub.
  NOTIFICATION_EMAIL: 'your-email@gmail.com' 
};
