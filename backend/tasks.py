import os
import time
import chromadb
import google.generativeai as genai
from celery_app import celery_app
from pypdf import PdfReader
from dotenv import load_dotenv

# Load env variables so Celery can see your Gemini API Key
load_dotenv()

# 1. Configure Gemini for the Worker
api_key = os.getenv("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

# 2. Initialize ChromaDB inside the Worker
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

def chunk_text(text: str, chunk_size: int = 500, overlap: int = 100) -> list:
    """Helper function to split text into readable overlapping chunks."""
    words = text.split()
    chunks = []
    for i in range(0, len(words), chunk_size - overlap):
        chunk_words = words[i:i + chunk_size]
        chunk = " ".join(chunk_words)
        chunks.append(chunk)
    return chunks

@celery_app.task(name="tasks.process_study_pdf", bind=True, max_retries=3)
def process_study_pdf(self, file_path: str):
    """
    Background task to parse PDF, chunk text, and save to ChromaDB vector store in strict batches.
    """
    # Extract just the filename (e.g., 'agenticai.pdf') from the full temp path
    filename = os.path.basename(file_path)
    print(f"📥 Starting background processing for: {filename}")
    
    try:
        # Step 1: Extract Text
        reader = PdfReader(file_path)
        total_pages = len(reader.pages)
        extracted_text = ""
        
        for index, page in enumerate(reader.pages):
            text = page.extract_text()
            if text:
                extracted_text += text + "\n"
                
            # Update frontend progress bar
            self.update_state(
                state="PROCESSING", 
                meta={"current_page": index + 1, "total_pages": total_pages}
            )
            
        print(f"📄 Extraction complete. Found {len(extracted_text)} characters.")
        
        # Step 2: Chunk the text
        chunks = chunk_text(extracted_text, chunk_size=500, overlap=100)
        if not chunks:
            print("⚠️ No readable text found in document.")
            return {"status": "error", "message": "No readable text extracted."}

        print(f"🧩 Splitting text into {len(chunks)} chunks for AI analysis...")

        # Step 3: Prepare database payloads
        documents = []
        metadatas = []
        ids = []

        for idx, chunk in enumerate(chunks):
            documents.append(chunk)
            metadatas.append({"source": filename, "chunk_index": idx})
            ids.append(f"{filename}_chunk_{idx}")

        # Step 4: Insert into Vector Database in STRICT BATCHES
        print(f"💾 Saving to ChromaDB Vector Database in strict batches to avoid API limits...")
        
        batch_size = 15 # Send max 15 chunks at a time
        for i in range(0, len(documents), batch_size):
            end_idx = min(i + batch_size, len(documents))
            print(f"   -> Saving chunks {i} to {end_idx} of {len(documents)}...")
            
            collection.add(
                documents=documents[i:end_idx],
                metadatas=metadatas[i:end_idx],
                ids=ids[i:end_idx]
            )
            
            # Pause for 5 seconds between batches. 
            # 1 batch every 5 seconds = 12 requests per minute (Safely under Google's 15 RPM limit!)
            time.sleep(5)
            
        # Cleanup the temporary file now that it's in the database
        if os.path.exists(file_path):
            os.remove(file_path)
        
        print(f"🎉 Task complete for {filename}! Database populated.")
        return {
            "status": "success",
            "file_processed": filename,
            "total_pages": total_pages,
            "chunks_saved": len(chunks)
        }

    except Exception as exc:
        print(f"❌ Error encountered processing PDF: {exc}")
        # Properly pass the exception object to the retry mechanism so it doesn't crash
        raise self.retry(exc=exc, countdown=15)