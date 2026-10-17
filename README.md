# Vaani AI Workspace — Autonomous Personal AI Workspace

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-success?style=for-the-badge&logo=vercel)](https://vaani-ai-workspace-frontend.vercel.app/)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github)](https://github.com/jvjitendra/vaani-ai-workspace)

Vaani AI Workspace is a modern personal AI assistant and autonomous productivity workspace. It features a cosmic glassmorphism interface, autonomous tool routing, TaskFlow ecosystem integration, daily executive intelligence briefings, persistent memory, a permanent document library powered by full-text search (FTS5), multimodal vision, live weather/time, interactive learning checks, and Web Speech voice & speech-synthesis capabilities.

---

## 🌟 Live Deployments & Flagship Projects

- **Vaani AI Workspace (Live Demo)**: [https://vaani-ai-workspace-frontend.vercel.app/](https://vaani-ai-workspace-frontend.vercel.app/)
- **Vaani Backend API**: `https://vaani-ai-workspace.vercel.app`
- **DevPilot (AI Software Engineering Assistant)**: [Live Demo](https://dev-pilot-ten.vercel.app) | [GitHub](https://github.com/jvjitendra/DevPilot)
- **TaskFlow (Task Management Platform)**: [Live Demo](https://task-manager-frontend-tau-lemon.vercel.app) | [GitHub](https://github.com/jvjitendra/task-manager)
- **Developer GitHub**: [https://github.com/jvjitendra](https://github.com/jvjitendra)

---

## 🚀 Key Capabilities & Architecture

### 1. Autonomous Tool Routing & Real-Time Context
- **Live Weather**: Instant geocoding and live forecasts via Open-Meteo for any global city or coordinates (handles colloquial queries like *"Kharar ka weather"*, *"Delhi temperature"*).
- **Safe Calculator**: Safe Abstract Syntax Tree (AST) mathematical evaluator for precise calculations without arbitrary code execution risk.
- **Web Research**: Integrated web research with DuckDuckGo fallback and source citation.
- **Clock & Living Cosmos**: Real-time celestial clock, orbital motion, living starfield parallax, and status diagnostics.

### 2. Persistent Memory & Knowledge Library
- **SQLite FTS5 Brain Database (`brain_db.py`)**: Embedded SQLite database with full-text search (FTS5) and BM25 ranking for conversation archival, user preferences, and permanent document indexing.
- **File Knowledge Library**: Upload PDFs, DOCX, TXT, or code documents into a permanent searchable knowledge base with chunking and source attribution.
- **Explicit Memory**: Save, view, and manage long-term user preferences that dynamically inject into conversation context.

### 3. Interactive UI & Multimodal Intelligence
- **Cosmic Space Glassmorphism**: Handcrafted UI theme featuring planets, orbital tracks, interactive modals, responsive drawers, and focus mode.
- **Interactive MCQs (`renderMCQBlock`)**: Dynamic multiple-choice question cards rendered from markdown for interactive knowledge self-testing with immediate feedback and explanations.
- **Interactive Action Checklists (`renderChecklistBlock`)**: Toggleable markdown task lists with real-time progress indicators and copyable output.
- **Speech & Voice**: Continuous microphone input via Web Speech Recognition and complete message read-aloud via Web SpeechSynthesis.
- **Multimodal Vision & Media**: Image analysis, document processing, image creation/editing, and short video generation.

---

## 🛠️ Local Development & Setup

### Prerequisites
- Python 3.10+
- Modern Web Browser (Chrome, Edge, Firefox, Safari)

### Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Create a `.env` file inside `backend/` with your API keys:
   ```env
   GROQ_API_KEY="your_groq_api_key"
   GEMINI_API_KEY="your_gemini_api_key"
   PORT=5288
   ```
4. Start the backend server:
   ```bash
   python app.py
   ```
   The backend will be live at `http://127.0.0.1:5288`.

### Frontend Setup
Open `frontend/index.html` in your browser, or serve it with any static HTTP server:
```bash
cd frontend
python -m http.server 3000
```
Then visit `http://127.0.0.1:3000`.

---

## 🔒 Security & Privacy
- Never commit `backend/.env` or any private API keys.
- Local SQLite database files (`*.db`) are kept out of version control via `.gitignore`.
- Calculations are strictly evaluated using a restricted AST parser.

---

## 👨‍💻 Developer & Creator

**Jitendra Kumar Verma**  
*Software Engineer · Computer Science & Engineering*  
- GitHub: [@jvjitendra](https://github.com/jvjitendra)  
- LinkedIn: [in/jvjitendra](https://www.linkedin.com/in/jvjitendra/)  
- Portfolio / Flagship Projects: [DevPilot](https://dev-pilot-ten.vercel.app) · [TaskFlow](https://task-manager-frontend-tau-lemon.vercel.app) · [Vaani AI Workspace](https://vaani-ai-workspace-frontend.vercel.app/)
