/**
 * NEXUS FOR GMAIL - SECRETS
 * * WHY THIS FILE EXISTS:
 * You never want to hardcode passwords or API keys directly into the main
 * logic of your application, especially if you plan to share the code on
 * platforms like GitHub. By isolating the API key here, users can easily add their 
 * credentials without accidentally breaking the core engine.
 * * SECURITY WARNING: 
 * If you upload this project to a public GitHub repository, do NOT include your 
 * actual API key in the commit. Leave it as 'YOUR_GEMINI_API_KEY'.
 */

const SECRETS = {
  // The unique identifier that authorizes this script to talk to Google's AI servers.
  // Generate a free key at: https://aistudio.google.com/
  GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY',
  BRANDFETCH_API_KEY: 'YOUR_BRANDFETCH_API_KEY',
  LOGODEV_SECRET_KEY: 'YOUR_LOGODEV_SECRET_KEY',
  NOTIFICATION_EMAIL: 'your-email@gmail.com' 
};
