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
import time

def log(message):
    """Helper function to log messages to stderr"""
    print(message, file=sys.stderr, flush=True)

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
        
        log("Initializing RAG service...")
        log(f"Activity ID: {activity_id}")
        log("Fetching documents...")
          
        try:
            # Initialize vectorstore
            self.vectorstore = self._initialize_vectorstore()
            log("Vectorstore initialization complete!")
        except Exception as e:
            log(f"Error initializing vectorstore: {str(e)}")
            raise

    def _initialize_vectorstore(self):
        """Load documents and create vectorstore during initialization"""
        try:
            log(f"Making request to: {self.api_base_url}/api/llm/documents?activityId={self.activity_id}")
            docs_metadata = self.fetch_documents(self.activity_id)
            log(f"Found {len(docs_metadata)} documents")
            
            # Handle empty documents case
            if not docs_metadata:
                log("No documents found for this activity - operating in general knowledge mode")
                self.vectorstore = None
                return None
                
            log("Loading document contents...")
            documents = []
            for doc in docs_metadata:
                try:
                    content = self.load_document(doc["url"])
                    documents.append(content)
                    log(f"Loaded document: {doc.get('name', 'unknown')}")
                except Exception as e:
                    log(f"Failed to load document {doc.get('name', 'unknown')}: {str(e)}")
            
            if not documents:
                log("No valid documents could be loaded - operating in general knowledge mode")
                self.vectorstore = None
                return None
                
            log("Creating vectorstore...")
            texts = []
            for doc in documents:
                texts.extend(self.text_splitter.split_text(doc))
            log(f"Created {len(texts)} text chunks")
            
            self.vectorstore = FAISS.from_texts(texts, self.embeddings)
            return self.vectorstore
            
        except Exception as e:
            log(f"Error initializing vectorstore: {str(e)}")
            log(traceback.format_exc())
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
        log(f"Making request to: {url}")
        
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
        """Query local LLM server with context"""
        # Handle empty context case more gracefully
        if context:
            full_prompt = f"{system_prompt}\n\nContext:\n{context}\n\nQuestion: {prompt}"
        else:
            full_prompt = f"{system_prompt}\n\nQuestion: {prompt}"
        
        log(f"\nSending request to local LLM server...")
        log(f"System prompt: {system_prompt}")
        log(f"Context length: {len(context)} characters")
        log(f"Query: {prompt}")
        log(f"Full prompt: {full_prompt}")
        
        try:
            log("Attempting to connect to LLM server at http://localhost:8080/api/generate")
            response = requests.post(
                'http://localhost:8080/api/generate',
                json={
                    "prompt": full_prompt
                },
                headers={'Content-Type': 'application/json'},
                timeout=30  # Add timeout
            )
            
            if not response.ok:
                error_msg = f"LLM request failed: {response.status_code} - {response.text}"
                log(error_msg)
                raise Exception(error_msg)

            # Parse JSON response
            response_data = response.json()
            if 'response' not in response_data:
                error_msg = "Invalid response format from LLM server"
                log(error_msg)
                raise Exception(error_msg)

            full_response = response_data['response']
            log(f"Full response: {full_response}")
            return full_response
            
        except requests.exceptions.ConnectionError as e:
            error_msg = f"Failed to connect to LLM server: {str(e)}"
            log(error_msg)
            log("Is the Ollama server running? Try running: ollama serve")
            raise Exception(error_msg)
        except requests.exceptions.Timeout as e:
            error_msg = f"LLM request timed out: {str(e)}"
            log(error_msg)
            raise Exception(error_msg)
        except Exception as e:
            error_msg = f"Error querying LLM server: {str(e)}"
            log(error_msg)
            log("Full traceback:")
            log(traceback.format_exc())
            raise Exception(error_msg)
        
    def get_context_for_query(self, query: str, k: int = 3) -> str:
        """Get relevant context for a query using the preloaded vectorstore"""
        if not self.vectorstore:
            log("No vectorstore available - using general knowledge")
            return ""
            
        try:
            docs = self.vectorstore.similarity_search(query, k=k)
            return "\n".join([doc.page_content for doc in docs])
        except Exception as e:
            log(f"Error retrieving context: {str(e)}")
            return ""

if __name__ == "__main__":
    try:
        # Immediate startup logging
        log("=== RAG Service Starting ===")
        log(f"Python version: {sys.version}")
        log(f"Current working directory: {os.getcwd()}")
        
        # Load environment variables from .env.local
        env_path = Path(os.getcwd()) / '.env.local'
        log(f"Loading environment from: {env_path}")
        
        if not env_path.exists():
            log(f"ERROR: .env.local file not found at {env_path}")
            sys.exit(1)
            
        load_dotenv(dotenv_path=env_path)
        
        parser = argparse.ArgumentParser()
        parser.add_argument("--preprompt", type=str, default="")
        parser.add_argument("--prompt_suffix", type=str, default="")
        parser.add_argument("--api_base_url", type=str, required=True)
        parser.add_argument("--activity_id", type=str, required=True)
        args = parser.parse_args()
        
        log("Parsed arguments:")
        log(f"  preprompt: {args.preprompt}")
        log(f"  prompt_suffix: {args.prompt_suffix}")
        log(f"  api_base_url: {args.api_base_url}")
        log(f"  activity_id: {args.activity_id}")
        
        api_secret_key = 'YrFvjWY7a6RUEZyu'
        if not api_secret_key:
            log("ERROR: API_SECRET_KEY not found in .env.local")
            sys.exit(1)
        
        log("Initializing RAG service...")
        log(f"Activity ID: {args.activity_id}")
        
        try:
            rag_service = RAGService(
                api_secret_key=api_secret_key,
                api_base_url=args.api_base_url,
                activity_id=args.activity_id
            )
            log("RAG service initialized successfully!")
            log("Waiting for input messages...")
            
            # Test stdin is working
            log("Testing stdin...")
            log("Please send a test message...")
            
            # Listen for messages
            while True:
                try:
                    log("Waiting for input from stdin...")
                    line = sys.stdin.buffer.readline()
                    
                    # Skip empty lines without logging
                    if not line or line.isspace():
                        continue
                        
                    log(f"Received {len(line)} bytes from stdin")
                    log(f"Raw input received: {line}")
                    
                    try:
                        message = json.loads(line.decode("utf-8"))
                        log(f"Parsed message: {message}")
                        
                        # Log message details
                        log(f"Message content: {message.get('content', 'No content')}")
                        log(f"Activity ID: {message.get('activityId', 'No activity ID')}")
                        
                        query = message['content'].strip()
                        log(f"Processed query: {query}")
                        
                        # Get context using preloaded vectorstore
                        log("Fetching context for query...")
                        context = rag_service.get_context_for_query(query)
                        log(f"Retrieved context length: {len(context)} characters")
                        
                        # Query LLM with context
                        log("Querying LLM...")
                        try:
                            response = rag_service.query_ollama(
                                prompt=query,
                                context=context,
                                system_prompt=args.preprompt
                            )
                            log(f"LLM response received: {response}")
                            
                            # Send response back
                            response_text = f"Agent -> {message.get('peerName', 'User')}:: {response}"
                            log(f"Sending response: {response_text}")
                            print(response_text, flush=True)  # Ensure the response is sent immediately
                            log("Response sent successfully")
                            
                        except Exception as e:
                            log(f"Error during LLM query: {str(e)}")
                            log(traceback.format_exc())
                            error_response = f"Agent -> {message.get('peerName', 'User')}:: I apologize, but I encountered an error processing your request."
                            print(error_response, flush=True)
                            log("Error response sent")
                        
                    except json.JSONDecodeError as e:
                        log(f"Error decoding JSON message: {e}")
                        log(f"Raw message: {line}")
                    except Exception as e:
                        log(f"Error processing message: {e}")
                        log(traceback.format_exc())
                        
                except Exception as e:
                    log(f"Error in main loop: {e}")
                    log(traceback.format_exc())
                    time.sleep(1)  # Prevent tight loop on error
                    
        except Exception as e:
            log(f"Fatal error initializing RAG service: {e}")
            log(traceback.format_exc())
            sys.exit(1)
    except Exception as e:
        log(f"Fatal error: {e}")
        log(traceback.format_exc())
        sys.exit(1)