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
    def __init__(self, api_secret_key: str, api_base_url: str):
        self.api_secret_key = api_secret_key
        self.api_base_url = api_base_url
        self.embeddings = HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-mpnet-base-v2"
        )
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=50
        )

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
        print(f"\nMaking request to: {url}")
        print(f"With token: {token[:20]}...")
        
        response = requests.get(
            url,
            headers={
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/json'
            }
        )
        
        print(f"Response Status: {response.status_code}")
        if response.status_code != 200:
            raise Exception(f"Failed to fetch documents: {response.status_code}")
        
        # Direct return of JSON response (should be a list of documents)
        return response.json()

    def load_document(self, url: str) -> str:
        """Load document content from URL"""
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
        print(f"\nSending request to Ollama...")
        
        request_data = {
            "model": "granite3-dense",
            "prompt": prompt,
            "system": system_prompt
        }
        if context:
            request_data["context"] = context
        
        print(f"\nRequest data: {json.dumps(request_data, indent=2)}")
        
        try:
            # Stream both request and response
            response = requests.post(
                'http://localhost:11434/api/generate',
                json=request_data,
                stream=True
            )
            
            print(f"\nResponse status: {response.status_code}")
            print(f"Response headers: {dict(response.headers)}")
            print(f"Response error (if any): {response.text}")
            
            if not response.ok:
                raise Exception(f"Ollama request failed: {response.status_code} - {response.text}")
            
            # Process the streaming response
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
        
    def get_relevant_context(self, query: str, vectorstore: FAISS, k: int = 3) -> str:
        """Retrieve relevant context from vectorstore"""
        docs = vectorstore.similarity_search(query, k=k)
        return "\n".join([doc.page_content for doc in docs])