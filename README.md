# AI Study Assistant - Full-Stack RAG Web Application

An advanced, full-stack Artificial Intelligence web application designed to process PDF documents and autonomously generate interactive study materials, quizzes, and flashcards using a Retrieval-Augmented Generation (RAG) architecture[cite: 1].

## 🚀 Key Features

* **Intelligent Document Processing (RAG):** Integrates ChromaDB as a vector database with a Python FastAPI backend to perform semantic search and context retrieval before passing data to the Google Gemini API[cite: 1].
* **Fault-Tolerant Ingestion Pipeline:** Architected a distributed background task queue utilizing Redis and Celery. Features batch-processing and automatic retries to safely bypass strict external API rate limits during massive document uploads[cite: 1].
* **Enterprise-Grade Security:** Ensures strict data isolation and multi-tenant security via Clerk JWT authentication and Supabase Row Level Security (RLS) policies[cite: 1].
* **Modern UI/UX:** Features a fully responsive, glassmorphism-inspired user interface built with React and Tailwind CSS[cite: 1].

## 🛠️ Tech Stack

**Frontend**
* React.js
* Tailwind CSS
* Clerk (Authentication)[cite: 1]

**Backend & ML Pipeline**
* Python / FastAPI
* Google Gemini API (LLM)
* ChromaDB (Vector Database)[cite: 1]

**Database & Task Queues**
* Supabase (PostgreSQL)[cite: 1]
* Redis & Celery (Distributed background worker queue)[cite: 1]

## 🏗️ System Architecture

1. **Upload & Queue:** User uploads a PDF via the React frontend. The backend accepts the file and pushes a processing job to the Redis/Celery task queue[cite: 1].
2. **Chunking & Embedding:** Celery workers pick up the job, extract text, chunk the document, generate vector embeddings, and store them in ChromaDB[cite: 1].
3. **Retrieval-Augmented Generation:** When a user requests a quiz or study guide, FastAPI queries ChromaDB for the most relevant document context, appending it to the Gemini API prompt to generate highly accurate, grounded study materials[cite: 1].
4. **Secure Delivery:** Results are delivered back to the client, secured by Clerk JWTs and Supabase RLS[cite: 1].

## ⚙️ Local Setup & Installation

### Prerequisites
* Python 3.9+
* Node.js & npm
* Redis Server (running locally or via Docker)

### Environment Variables
Create a `.env` file in both the frontend and backend directories. You will need keys for:
* `GEMINI_API_KEY`
* `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`
* `SUPABASE_URL` / `SUPABASE_ANON_KEY`
* `CELERY_BROKER_URL` (Redis)

### Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`
pip install -r requirements.txt

# Start the Redis server (if running locally)
redis-server

# Start the Celery worker
celery -A main.celery_app worker --loglevel=info

# Start the FastAPI server
uvicorn main:app --reload
