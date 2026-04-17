# Nexus for Gmail 📧🧠

**An autonomous, AI-powered classification engine for Google Workspace.** *Co-architected by Frank Katzenberger and Gemini AI.*

Nexus is a self-hosted, highly configurable Google Apps Script that acts as an intelligent assistant for your inbox. Instead of relying on rigid, easily broken keyword filters, Nexus utilizes Google's Gemini LLMs to read, comprehend, and categorize your emails based on contextual meaning. It operates completely in the background, automatically routing messages into a dynamic, color-coded folder structure while keeping your data safely contained within your personal Google Workspace.

## ✨ Key Features
* **Zero-Touch Autonomy:** Natively generates Gmail filters to tag incoming mail the millisecond it arrives, then processes it silently in the background.
* **1-Click Installation:** Automatically builds its own Google Drive folder architecture, creates a dynamic System Prompt Document, and generates all necessary Gmail labels natively.
* **Dynamic Taxonomy:** Completely customizable top-level entity routing (e.g., Business, Financial, People) using simple key-value configuration.
* **Smart Blacklisting:** Absolute control over the AI. Explicitly forbid the engine from using certain labels or prevent it from creating unwanted new ones.
* **Contextual Flags:** Intelligently applies "Important" markers based on required actions in the email body and restricts "Starred" markers to active conversations.
* **Hyper-Efficient Processing:** Groups incoming emails by sender domain before processing, allowing it to classify dozens of emails simultaneously while consuming minimal API tokens.
* **Deep Telemetry:** Automatically generates daily, visually styled HTML execution logs (with system cleanup tracking) and raw `.txt` debug logs directly in your Google Drive.
* **Automated Update Checking:** Pings GitHub once a day and emails you automatically when a new release is available.

---

## ⚙️ How the Script Works
1. **The Interception:** When an email arrives, a native Gmail filter (created during installation) instantly applies an `ai-ready` label, excluding any system tabs you told it to ignore (like Promotions or Social).
2. **The Sweep:** Every 5 minutes, the background script wakes up and gathers up to 40 `ai-ready` threads.
3. **The Batching:** It sorts the emails by sender domain, packages them into optimized payloads, and injects your dynamic labels and blacklist rules into the prompt.
4. **The Brain:** The payload is sent to the Gemini API, which evaluates the context of the email bodies. 
5. **The Execution:** Nexus receives the JSON payload, applies the appropriate category/entity/purpose labels, colorizes them, applies action flags, drops the `ai-ready` label, and logs the telemetry.

---

## 🎛️ Configuration Variables (`Config.gs`)
Nexus is built to be customized without touching the core engine. All behavioral adjustments are made in the `Config.gs` file.

| Variable | Description |
| :--- | :--- |
| `VERSION` | The semantic version tracker used for automated update checks. |
| `GITHUB_REPO` | The repository path Nexus checks daily for new releases. |
| `GEMINI_MODEL` | The AI model used. Defaults to `gemini-2.5-flash-lite` for maximum cost-efficiency. |
| `JOB_INTERVAL_MINUTES` | How frequently the background processing engine triggers (Default: 5). |
| `DEBUG_MODE` | Toggles the generation of raw `.txt` AI output logs for troubleshooting. |
| `ENTITIES` | A dictionary of your top-level parent folders and instructions for what belongs in them. |
| `DEFAULT_PURPOSES` | A list of standard sub-categories (e.g., Receipts, Support, Subscriptions). |
| `BLACKLIST` | Defines forbidden terms. `DO_NOT_USE` prevents the AI from assigning them entirely. `DO_NOT_CREATE` prevents the engine from making new Gmail labels for them. |
| `AUTO_TAGGING` | Controls the native Gmail filter generation and defines which native tabs (e.g., Promotions) to skip. |
| `FLAG_RULES` | Strict, Moderate, or Lenient rules dictating when the AI applies "Important" or "Starred" flags. |
| `PALETTE` | The hex color codes used by the Advanced Gmail API to colorize labels. |

---

## 🛠️ Setup Architecture (`Setup.gs`)
The installation and initialization logic is separated into `Setup.gs` to keep the main engine lightweight. 

| Function | Purpose |
| :--- | :--- |
| `installNexus()` | The master orchestration function. The only function the user needs to run manually. |
| `initializeDriveSystem()` | Creates the "Email Classification Engine" master folder and the "System Prompt" Google Doc. |
| `initializeLabels()` | Reads the `ENTITIES` and `DEFAULT_PURPOSES` in config to pre-build necessary Gmail labels safely. |
| `setupAutoRun()` | Establishes the recurring 5-minute engine trigger and the daily update checker. |
| `setupAutoTagFilter()` | Uses the Advanced Gmail API to create a permanent, native incoming mail filter for `ai-ready`. |
| `checkForUpdates()` | Background utility that queries GitHub for new releases and sends an email notification. |
| `resetSystemPrompt()` | A fail-safe utility to overwrite the Google Doc with factory default instructions if formatting is broken. |

---

## 🔑 Google API Setup

Before installing Nexus, you need to prepare your Google environment:

1. **Get a Gemini API Key:**
   * Go to [Google AI Studio](https://aistudio.google.com/).
   * Sign in with your Google account and click **Get API Key**.
   * Create a new key and copy it. (This is free).

2. **Enable the Advanced Gmail API:**
   * Go to [script.google.com](https://script.google.com/) and create a **New Project**.
   * In the left-hand sidebar, click the **+** icon next to **Services**.
   * Scroll down, select **Gmail API**, and click **Add**. *(This allows Nexus to physically color-code your folders and create native filters).*

---

## 🚀 Installation Guide

1. **Add the Codebase:** Rename your Google Apps Script project to `Nexus for Gmail`. Create four separate script files (`.gs`) and copy the code from this GitHub repository into them:
   * `Secrets.gs` 
   * `Config.gs`
   * `Setup.gs`
   * `Main.gs`
2. **Secure Your Secrets:** Open `Secrets.gs`. Paste your Gemini API Key and your preferred notification email address into the variables. Click **Save** (the floppy disk icon).
3. **Run the 1-Click Installer:** * Look at the toolbar at the top of the editor. Select **`installNexus`** from the dropdown menu.
   * Click **Run**. 
   * *Note: Google will ask for permission to access your Drive and Gmail. Click **Review permissions**, choose your account, click **Advanced**, and select **Go to project (unsafe)** to grant access.*
4. Check the Execution Log at the bottom of the screen. You will see an "INSTALLATION COMPLETE!" message along with a direct link to your newly generated AI System Prompt in Google Drive. 

---

## 🧠 Customizing the AI's Brain (The Google Doc)
You do not need to edit code to change how the AI categorizes mail. During installation, Nexus created a Google Document called **System Prompt - Email AI** in your Drive. 

This document is the literal "brain" of the operation. Open it and add your own plain-English rules (e.g., *"If the email is a food delivery receipt, always set the category to 'Updates'."*). The engine reads this document live during every execution, meaning your custom instructions are adapted immediately.

*(Note: Do not delete the bracketed variables like `{{ENTITIES}}` or `{{PAYLOAD}}`, as the script uses these to inject your live data).*

### 🔄 Checking for Updates
Nexus will automatically email you when a new release is published. To update:
1. Check the [Releases page](../../releases) on this repository.
2. Copy the updated code from GitHub and paste it over your existing `.gs` files. *(You rarely need to overwrite `Secrets.gs` or `Config.gs` unless explicitly stated in the release notes, keeping your personal settings perfectly intact!)*

---

## 📜 License and Copyright

**Code License:** This project is licensed under the [GNU General Public License v3.0](LICENSE). You are completely free to use, copy, modify, and distribute this software. However, if you distribute a modified version, you **must** make your source code openly available under the exact same GPLv3 license. 

**Brand Protection:** While the code is open-source, the name **"Nexus for Gmail"** is reserved. If you fork this repository to create a heavily modified, divergent, or commercial version, I ask that you choose a new name for your variant to avoid confusing users who are looking for the official, stable release.
