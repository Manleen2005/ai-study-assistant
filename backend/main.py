from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import Optional
import PyPDF2
import io
import chromadb
import os
import shutil
import google.generativeai as genai
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware

# --- NEW CELERY IMPORTS ---
from celery.result import AsyncResult
from celery_app import celery_app
from tasks import process_study_pdf

# Load environment variables
load_dotenv()

# Configure Google Gemini
api_key = os.getenv("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

app = FastAPI(title="AI Study Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # The "*" means allow requests from any URL!
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- NEW: SETUP TEMPORARY UPLOAD FOLDER FOR CELERY ---
UPLOAD_DIR = "temp_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Initialize ChromaDB
chroma_client = chromadb.PersistentClient(path="./chroma_data")

class GeminiEmbeddingFunction(chromadb.EmbeddingFunction):
    def __call__(self, input: chromadb.Documents) -> chromadb.Embeddings:
        response = genai.embed_content(
            model="models/gemini-embedding-001",
            content=input,
            task_type="retrieval_document"
        )
        return response['embedding']

gemini_embeddings = GeminiEmbeddingFunction()
collection = chroma_client.get_or_create_collection(
    name="study_materials_gemini",
    embedding_function=gemini_embeddings
)

# --- UPGRADED REQUEST SCHEMAS ---

class QueryRequest(BaseModel):
    question: str
    n_results: int = 3

class ChatRequest(BaseModel):
    question: str
    filename: Optional[str] = None
    history: list = []
# --- CORE LOGIC ---

def extract_text_from_pdf(file_bytes: bytes) -> str:
    reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
    text = ""
    for page in reader.pages:
        extracted = page.extract_text()
        if extracted:
            text += extracted + "\n"
    return text

def chunk_text(text: str, chunk_size: int = 500, overlap: int = 100) -> list:
    words = text.split()
    chunks = []
    for i in range(0, len(words), chunk_size - overlap):
        chunk_words = words[i:i + chunk_size]
        chunk = " ".join(chunk_words)
        chunks.append(chunk)
    return chunks

# --- API ENDPOINTS ---

# 1. NEW CELERY ASYNC ENDPOINT
@app.post("/api/upload-async")
async def upload_document_async(file: UploadFile = File(...)):
    """
    Receives the PDF, saves it temporarily, and dispatches to Celery queue.
    """
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
        
    # Save the file to our local disk so the Celery worker can access it
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # Dispatch to background worker
    task = process_study_pdf.delay(file_path)
    
    # Instantly return task receipt
    return {
        "message": "File received! Processing in the background.",
        "task_id": task.id,
        "filename": file.filename
    }

# 2. NEW CELERY STATUS ENDPOINT
@app.get("/api/task-status/{task_id}")
async def get_task_status(task_id: str):
    """
    Frontend checks this endpoint to see if the background task is done.
    """
    task_result = AsyncResult(task_id, app=celery_app)
    
    response = {
        "task_id": task_id,
        "status": task_result.status,
    }
    
    if task_result.status == "SUCCESS":
        response["result"] = task_result.result
    elif task_result.status == "PROCESSING":
        response["progress"] = task_result.info 
        
    return response

# 3. EXISTING SYNC ENDPOINT (Kept intact for safety)
@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)):
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    try:
        contents = await file.read()
        extracted_text = extract_text_from_pdf(contents)
        chunks = chunk_text(extracted_text, chunk_size=500, overlap=100)

        if not chunks:
            return {"filename": file.filename, "status": "No text extracted"}

        documents = []
        metadatas = []
        ids = []

        for idx, chunk in enumerate(chunks):
            documents.append(chunk)
            metadatas.append({"source": file.filename, "chunk_index": idx})
            ids.append(f"{file.filename}_chunk_{idx}")

        collection.add(
            documents=documents,
            metadatas=metadatas,
            ids=ids
        )

        return {
            "filename": file.filename,
            "status": "successfully indexed with Gemini Embeddings",
            "metrics": { "total_chunks_saved": len(chunks) }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error indexing file: {str(e)}")

# 4. EXISTING CHAT ENDPOINT
@app.post("/api/chat")
async def chat_with_document(request: ChatRequest):
    """Retrieves context, optionally filtering by filename, and queries Gemini with Conversation History."""
    try:
        # Build search filters dynamically
        search_filter = None
        if request.filename:
            search_filter = {"source": request.filename}

        # 1. Query database with metadata filter
        results = collection.query(
            query_texts=[request.question],
            n_results=10,
            where=search_filter
        )
        
        context_chunks = []
        sources = []
        if results['documents'] and len(results['documents']) > 0:
            for i in range(len(results['documents'][0])):
                context_chunks.append(results['documents'][0][i])
                sources.append(results['metadatas'][0][i].get("source", "Unknown"))
                
        if not context_chunks:
            return {
                "question": request.question,
                "answer": "I couldn't find any information regarding that in the specified file.",
                "sources": []
            }

        context_string = "\n\n---\n\n".join(context_chunks)
        
        # 2. Format the conversation history for the AI
        formatted_history = ""
        if request.history:
            for msg in request.history:
                role = "Student" if msg.get("role") == "user" else "Professor AI"
                content = msg.get("content", "")
                formatted_history += f"{role}: {content}\n"
        
        # 3. Build the Context-Aware Prompt
        prompt = f"""
        You are a helpful AI Study Assistant. Answer the user's question using ONLY the provided context from their study materials.
        If you cannot find the answer in the context, say "I cannot find this in the document."
        
        === Previous Conversation History ===
        {formatted_history}
        
        === Provided Document Context ===
        {context_string}
        
        === Student's Current Question ===
        {request.question}
        
        Answer:
        """
        
        model = genai.GenerativeModel("gemini-2.5-flash")
        response = model.generate_content(prompt)
        
        return {
            "question": request.question,
            "answer": response.text,
            "sources": list(set(sources)) # Returns unique filenames
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error during chat generation: {str(e)}")