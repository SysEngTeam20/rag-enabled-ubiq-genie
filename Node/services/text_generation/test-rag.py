import json
import sys
import os
from pathlib import Path
from dotenv import load_dotenv
from rag_service import RAGService
import traceback

def main():
    try:
        # Debug paths
        current_dir = os.getcwd()
        print(f"Current working directory: {current_dir}")
        
        # Try different possible locations for .env.local
        possible_paths = [
            Path(current_dir) / '.env.local',  # Current directory
            Path(current_dir).parent / '.env.local',  # One level up
            Path(current_dir).parent.parent / '.env.local',  # Two levels up
        ]
        
        print("\nChecking for .env.local in:")
        for path in possible_paths:
            print(f"- {path} {'(exists)' if path.exists() else '(not found)'}")
        
        # Use the first existing .env.local file found
        env_path = next((path for path in possible_paths if path.exists()), None)
        if not env_path:
            raise Exception(f".env.local file not found in any of the checked locations. Current directory: {current_dir}")

        print(f"\nLoading .env.local from: {env_path}")
        with open(env_path) as f:
            env_content = f.read()
            print("Environment file content:")
            print(env_content)
        
        load_dotenv(dotenv_path=env_path)
        
        # Get credentials from environment
        api_secret_key = os.getenv("API_SECRET_KEY")
        if not api_secret_key:
            raise Exception("API_SECRET_KEY not found in .env.local")
        print(f"\nAPI_SECRET_KEY found: {api_secret_key[:5]}...")
        
        api_base_url = os.getenv("API_BASE_URL", "http://localhost:3000")
        print(f"Using API base URL: {api_base_url}")
        
        print("\nInitializing RAG service...")
        rag_service = RAGService(api_secret_key, api_base_url)
        
        # Test message
        test_message = {
            "content": "What features of quantum computing make it different from classical computing?",
            "activity_id": "678d195d5263c5a501dc68e7"
        }
        print(f"\nTest message: {json.dumps(test_message, indent=2)}")
        
        try:
            print("\nFetching activity documents...")
            # Fetch documents
            docs_metadata = rag_service.fetch_documents(test_message["activity_id"])
            print(f"\nType of docs_metadata: {type(docs_metadata)}")
            print(f"Content of docs_metadata: {docs_metadata}")
            
            if not docs_metadata:
                raise Exception("No documents found for this activity")
                
            print("\nDocument metadata:", json.dumps(docs_metadata, indent=2))
            
            print("\nLoading document contents...")
            documents = []
            for doc in docs_metadata:
                try:
                    print(f"\nLoading document: {doc.get('filename', 'unknown')}")
                    content = rag_service.load_document(doc["url"])
                    print(f"Content length: {len(content) if content else 0} characters")
                    documents.append(content)
                except Exception as e:
                    print(f"Failed to load document {doc.get('filename', 'unknown')}: {str(e)}")
                    print("Document data:", json.dumps(doc, indent=2))
                    print(traceback.format_exc())
            
            if not documents:
                raise Exception("No document contents could be loaded")
                
            print(f"\nLoaded {len(documents)} documents")
            
            print("\nCreating vector store...")
            vectorstore = rag_service.create_vectorstore(documents)
            
            print("\nGetting relevant context...")
            context = rag_service.get_relevant_context(test_message["content"], vectorstore)
            print("\nRetrieved context:", context)
            
            print("\nQuerying LLM...")
            response = rag_service.query_ollama(
                prompt=f"Context:\n{context}\n\nQuestion: {test_message['content']}",
                system_prompt="You are a helpful AI assistant. Always refer to the specific information from the provided context in your response."
            )
            print("\nLLM Response:", response)
            
        except Exception as e:
            print(f"\n❌ Error in document processing: {str(e)}")
            print("Full traceback:")
            print(traceback.format_exc())
            
    except Exception as e:
        print(f"\n❌ Error in setup: {str(e)}")
        print("Full traceback:")
        print(traceback.format_exc())

if __name__ == "__main__":
    main()