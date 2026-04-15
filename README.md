# Nexus for Gmail 📧🧠

**An autonomous, AI-powered classification engine for Google Workspace.** *Co-architected by Frank Katzenberger and Gemini AI.*

Nexus is a self-hosted, highly configurable Google Apps Script that acts as an intelligent assistant for your inbox. Instead of relying on rigid keyword filters, Nexus uses Google's Gemini LLMs to read, comprehend, and categorize your emails based on contextual meaning, automatically routing them into an organized, color-coded folder structure.

## ✨ Key Features
* **Hyper-Efficient Processing:** Groups incoming emails by sender domain before processing, allowing it to classify dozens of emails while consuming minimal API tokens.
* **1-Click Installation:** Automatically builds its own Google Drive folder architecture, creates a dynamic System Prompt Document, and generates all necessary Gmail labels natively.
* **Smart Sensitivity Controls:** Configurable rules prevent the AI from over-flagging unimportant newsletters as "Important" or "Starred".
* **Deep Telemetry:** Automatically generates daily, visually styled HTML execution logs and raw `.txt` debug logs directly in your Google Drive.
* **Model Agnostic:** Fully supports the Gemini 2.5 and 3.x series models. Choose between the blistering speed of `Flash-Lite` or the deep reasoning of `Pro`.

---

## 🛠️ Prerequisites
1. A **Google Account** (Gmail or Google Workspace).
2. A **Google AI Studio API Key** (You can generate one for free at [aistudio.google.com](https://aistudio.google.com/)).

---

## 🚀 Installation Guide

### Step 1: Create the Apps Script Project
1. Go to [script.google.com](https://script.google.com/) and click **New Project**.
2. Rename the project to `Nexus for Gmail`.
3. In the left-hand sidebar, click the **+** icon next to *Services*, scroll down to **Gmail API**, and click **Add**. *(This enables Nexus to automatically color-code your folders).*

### Step 2: Add the Codebase
Create four separate script files (`.gs`) in your project and copy the code from this repository into them:
* `Secrets.gs` *(Your API key goes here!)*
* `Config.gs`
* `Setup.gs`
* `Main.gs`

### Step 3: Run the 1-Click Installer
1. Open `Secrets.gs` and paste your Gemini API Key into the variable. Click **Save** (the floppy disk icon).
2. Look at the toolbar at the top of the editor. Select **`installNexus`** from the dropdown menu.
3. Click **Run**. 
4. *Note: Google will ask for permission to access your Drive and Gmail. Click **Review permissions**, choose your account, click **Advanced**, and select **Go to project (unsafe)** to grant access.*

Check the Execution Log at the bottom of the screen. You will see an "INSTALLATION COMPLETE!" message along with a direct link to your newly generated AI System Prompt in Google Drive.

---

## ⚙️ How to Use Nexus

1. **Tag Emails:** In Gmail, apply the label `ai-ready` to any emails you want Nexus to process.
2. **Let it Run:** Every 5 minutes (or whatever interval you set in `Config.gs`), Nexus will silently sweep your inbox, gather the `ai-ready` emails, and classify them.
3. **Review:** Nexus will remove the `ai-ready` tag, apply the appropriate `Purpose` and `Entity` folders, colorize them, mark them `ai-done`, and flag them as Important or Starred based on your sensitivity settings.
4. **Edit the Brain:** Want to teach Nexus new tricks? Open the **"System Prompt - Email AI"** Google Document in your Google Drive and modify the instructions. The script will automatically adapt on its next run!

---

## 🎛️ Configuration (`Config.gs`)
Nexus is built to be customized. Open `Config.gs` to adjust:
* **`GEMINI_MODEL`**: Swap between `gemini-2.5-flash`, `gemini-3.1-flash-lite-preview`, etc.
* **`JOB_INTERVAL_MINUTES`**: Adjust how often the background script runs.
* **`FLAG_RULES`**: Tweak the sensitivity (Strict, Moderate, Lenient) for how the AI decides an email is "Important" or "Starred."
* **`DEFAULT_PURPOSES`**: Add or remove the standard sorting categories.

---

## 📜 License and Copyright

**Code License:** This project is licensed under the [GNU General Public License v3.0](LICENSE). You are completely free to use, copy, modify, and distribute this software. However, if you distribute a modified version, you **must** make your source code openly available under the exact same GPLv3 license. 

**Brand Protection:** While the code is open-source, the name **"Nexus for Gmail"** is reserved. If you fork this repository to create a heavily modified, divergent, or commercial version, I ask that you choose a new name for your variant to avoid confusing users who are looking for the official, stable release.
