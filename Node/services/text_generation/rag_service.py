import json
import sys
import argparse
import os
from dotenv import load_dotenv
from pathlib import Path
from typing import List, Dict
import requests
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings
from jwt import encode as jwt_encode
from datetime import datetime, timedelta
import traceback

class RAGService:
    def __init__(self, api_secret_key: str, api_base_url: str, activity_id: str):
        self.api_secret_key = api_secret_key
        self.api_base_url = api_base_url
        self.activity_id = activity_id
        self.embeddings = HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-mpnet-base-v2"
        )
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=50
        )
        self.vectorstore = None
        
        # Initialize vectorstore during startup
        print("\nInitializing RAG service...")
        print(f"Activity ID: {activity_id}")
        self.initialize_vectorstore()
        
    def initialize_vectorstore(self):
        """Load documents and create vectorstore during initialization"""
        try:
            print("\nFetching documents...")
            docs_metadata = self.fetch_documents(self.activity_id)
            print(f"Found {len(docs_metadata)} documents")
            
            print("\nLoading document contents...")
            documents = []
            for doc in docs_metadata:
                try:
                    content = self.load_document(doc["url"])
                    documents.append(content)
                    print(f"Loaded document: {doc.get('name', 'unknown')}")
                except Exception as e:
                    print(f"Failed to load document {doc.get('name', 'unknown')}: {str(e)}")
            
            if not documents:
                raise Exception("No documents could be loaded")
            
            print("\nCreating vectorstore...")
            texts = []
            for doc in documents:
                texts.extend(self.text_splitter.split_text(doc))
            print(f"Created {len(texts)} text chunks")
            
            self.vectorstore = FAISS.from_texts(texts, self.embeddings)
            print("Vectorstore initialization complete!")
            
        except Exception as e:
            print(f"Error initializing vectorstore: {str(e)}")
            print(traceback.format_exc())
            raise

    def fetch_documents(self, activity_id: str) -> List[Dict]:
        """Fetch documents using the token-based authentication"""
        token = jwt_encode(
            {
                'activityId': activity_id,
                'exp': datetime.utcnow() + timedelta(days=7)
            },
            self.api_secret_key,
            algorithm='HS256'
        )
        
        url = f"{self.api_base_url}/api/llm/documents?activityId={activity_id}"
        print(f"Making request to: {url}")
        
        response = requests.get(
            url,
            headers={
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/json'
            }
        )
        
        if response.status_code != 200:
            raise Exception(f"Failed to fetch documents: {response.status_code}")
        
        return response.json()

    def load_document(self, url: str) -> str:
        """Load document content from URL"""
        response = requests.get(url)
        if not response.ok:
            raise Exception(f"Failed to load document: {response.status_code}")
        return response.text
        
    def query_ollama(self, prompt: str, context: str = "", system_prompt: str = "") -> str:
        """Query Ollama's Granite model with context"""
        print(f"\nSending request to Ollama...")
        print(f"System prompt: {system_prompt}")
        print(f"Context length: {len(context)} characters")
        print(f"Query: {prompt}")
        
        request_data = {
            "model": "granite3-dense",
            "prompt": prompt,
            "system": system_prompt
        }
        if context:
            request_data["context"] = context
            
        try:
            response = requests.post(
                'http://localhost:11434/api/generate',
                json=request_data,
                stream=True
            )
            
            if not response.ok:
                raise Exception(f"Ollama request failed: {response.status_code} - {response.text}")
            
            # Process the streaming response
            print("\nResponse:", end=" ", flush=True)
            full_response = []
            for line in response.iter_lines(decode_unicode=True):
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                    if chunk.get('done', False):
                        break
                    if 'response' in chunk:
                        print(chunk['response'], end='', flush=True)
                        full_response.append(chunk['response'])
                except json.JSONDecodeError:
                    continue
            
            print()  # New line after streaming
            return ''.join(full_response)
            
        except requests.exceptions.ConnectionError:
            raise Exception("Failed to connect to Ollama. Is the Ollama server running?")
        except Exception as e:
            print(f"Error querying Ollama: {str(e)}")
            print(f"Full traceback:")
            print(traceback.format_exc())
            raise
        
    def get_context_for_query(self, query: str, k: int = 3) -> str:
        """Get relevant context for a query using the preloaded vectorstore"""
        if not self.vectorstore:
            raise Exception("Vectorstore not initialized")
        
        docs = self.vectorstore.similarity_search(query, k=k)
        return "\n".join([doc.page_content for doc in docs])

if __name__ == "__main__":
    # Load environment variables from .env.local
    env_path = Path(os.getcwd()) / '.env.local'
    load_dotenv(dotenv_path=env_path)
    
    parser = argparse.ArgumentParser()
    parser.add_argument("--preprompt", type=str, default="")
    parser.add_argument("--prompt_suffix", type=str, default="")
    parser.add_argument("--api_base_url", type=str, required=True)
    parser.add_argument("--activity_id", type=str, required=True)
    args = parser.parse_args()
    
    api_secret_key = os.getenv("API_SECRET_KEY")
    if not api_secret_key:
        raise Exception("API_SECRET_KEY not found in .env.local")
    
    rag_service = RAGService(
        api_secret_key=api_secret_key,
        api_base_url=args.api_base_url,
        activity_id=args.activity_id
    )
    
    # Listen for messages
    while True:
        try:
            line = sys.stdin.buffer.readline()
            if len(line) == 0 or line.isspace():
                continue
                
            try:
                message = json.loads(line.decode("utf-8"))
                query = message['content'].strip()
                
                # Get context using preloaded vectorstore
                context = rag_service.get_context_for_query(query)
                print(f"\nRetrieved context: {context}")
                
                # Query LLM with context
                response = rag_service.query_ollama(
                    prompt=f"Context:\n{context}\n\nQuestion: {query}",
                    system_prompt=args.preprompt
                )
                print(f"\nFinal response: {response}")
                
                sys.stdout.write(">" + response + "\n")
                sys.stdout.flush()
                
            except json.JSONDecodeError as e:
                print(f"Error parsing message: {e}")
                continue
                
        except Exception as e:
            print(f"Error processing message: {e}")
            print(traceback.format_exc())
            continue