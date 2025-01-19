import json
import sys
import argparse
import os
from dotenv import load_dotenv
from pathlib import Path
from typing import List, Dict
import requests
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.embeddings import HuggingFaceEmbeddings
from langchain.vectorstores import FAISS
import jwt
from datetime import datetime, timedelta

class RAGService:
    def __init__(self, api_secret_key: str, api_base_url: str):
        self.api_secret_key = api_secret_key
        self.api_base_url = api_base_url
        self.embeddings = HuggingFaceEmbeddings()
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=50
        )
        
    def generate_llm_token(self, activity_id: str) -> str:
        """Generate JWT token for LLM document access"""
        expiration = datetime.utcnow() + timedelta(days=7)
        token = jwt.encode(
            {
                'activityId': activity_id,
                'exp': expiration
            },
            self.api_secret_key,
            algorithm='HS256'
        )
        return token
        
    def fetch_documents(self, activity_id: str) -> List[Dict]:
        """Fetch documents using the token-based authentication"""
        token = self.generate_llm_token(activity_id)
        
        response = requests.get(
            f"{self.api_base_url}/api/llm/documents",
            headers={'Authorization': f'Bearer {token}'}
        )
        
        if not response.ok:
            raise Exception(f"Failed to fetch documents: {response.status_code}")
            
        return response.json()['documents']
            
    def load_document(self, url: str) -> str:
        """Load document content from signed URL"""
        response = requests.get(url)
        if not response.ok:
            raise Exception(f"Failed to load document: {response.status_code}")
        return response.text
            
    def create_vectorstore(self, documents: List[str]) -> FAISS:
        """Create FAISS vectorstore from documents"""
        texts = []
        for doc in documents:
            texts.extend(self.text_splitter.split_text(doc))
        return FAISS.from_texts(texts, self.embeddings)
        
    def query_ollama(self, prompt: str, context: str = "", system_prompt: str = "") -> str:
        """Query Ollama's Granite model with context"""
        response = requests.post('http://localhost:11434/api/generate', 
            json={
                "model": "granite",
                "prompt": prompt,
                "system": system_prompt,
                "context": context,
                "stream": False
            })
        return response.json()["response"]
        
    def get_relevant_context(self, query: str, vectorstore: FAISS, k: int = 3) -> str:
        """Retrieve relevant context from vectorstore"""
        docs = vectorstore.similarity_search(query, k=k)
        return "\n".join([doc.page_content for doc in docs])

def listen_for_messages(rag_service: RAGService, args: argparse.Namespace):
    message_log = []
    vectorstore = None
    current_activity_id = None
    
    while True:
        try:
            line = sys.stdin.buffer.readline()
            if len(line) == 0 or line.isspace():
                continue
                
            message = json.loads(line.decode("utf-8"))
            
            # Check if activity_id changed
            if "activity_id" in message and message["activity_id"] != current_activity_id:
                current_activity_id = message["activity_id"]
                try:
                    # Fetch documents using token-based authentication
                    docs_metadata = rag_service.fetch_documents(current_activity_id)
                    documents = [rag_service.load_document(doc["url"]) for doc in docs_metadata]
                    vectorstore = rag_service.create_vectorstore(documents)
                except Exception as e:
                    print(f">Error: Failed to load documents - {str(e)}")
                    continue
            
            query = message["content"].strip() + args.prompt_suffix
            
            # Get relevant context
            context = rag_service.get_relevant_context(query, vectorstore) if vectorstore else ""
            
            # Query LLM with context
            augmented_prompt = f"Context:\n{context}\n\nQuestion: {query}"
            response = rag_service.query_ollama(
                prompt=augmented_prompt,
                system_prompt=args.preprompt
            )
            
            print(">" + response)
            sys.stdout.flush()
            
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f">Error: {str(e)}")
            continue

if __name__ == "__main__":
    # Load environment variables from .env.local
    env_path = Path(os.getcwd()) / '.env.local'
    load_dotenv(dotenv_path=env_path)
    
    parser = argparse.ArgumentParser()
    parser.add_argument("--preprompt", type=str, default="")
    parser.add_argument("--prompt_suffix", type=str, default="")
    parser.add_argument("--api_base_url", type=str, required=True)
    args = parser.parse_args()
    
    api_secret_key = os.getenv('API_SECRET_KEY')
    if not api_secret_key:
        raise ValueError("API_SECRET_KEY environment variable is required")
    
    rag_service = RAGService(api_secret_key, args.api_base_url)
    listen_for_messages(rag_service, args)