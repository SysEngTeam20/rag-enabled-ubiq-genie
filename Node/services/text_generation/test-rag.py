import json
import sys
import os
from pathlib import Path
import traceback
from dotenv import load_dotenv
from rag_service import RAGService

def main():
    try:
        # Load environment variables from .env.local
        env_path = Path(os.getcwd()).parent / '.env.local'
        print(f"\nLoading environment from: {env_path}")
        
        if not env_path.exists():
            raise Exception(".env.local file not found")
            
        load_dotenv(dotenv_path=env_path)
        
        api_secret_key = os.getenv("API_SECRET_KEY")
        if not api_secret_key:
            raise Exception("API_SECRET_KEY not found in .env.local")
        print(f"API_SECRET_KEY found: {api_secret_key[:5]}...")
        
        api_base_url = os.getenv("API_BASE_URL", "http://localhost:3000")
        print(f"Using API base URL: {api_base_url}")
        
        activity_id = "0742fc56-8e73-4d73-9488-60a3d936351b"  # Test activity ID
        
        print("\nInitializing RAG service...")
        rag_service = RAGService(
            api_secret_key=api_secret_key,
            api_base_url=api_base_url,
            activity_id=activity_id
        )
        
        # Test queries
        test_queries = [
            "What features of quantum computing make it different from classical computing?",
            "How does quantum entanglement work in the XQZA-7?",
            "What are the main applications of this quantum computer?"
        ]
        
        print("\nTesting queries...")
        for query in test_queries:
            print(f"\n\nQuery: {query}")
            
            # Get context using preloaded vectorstore
            context = rag_service.get_context_for_query(query)
            print(f"\nRetrieved context: {context}")
            
            # Query LLM with context
            response = rag_service.query_ollama(
                prompt=f"Context:\n{context}\n\nQuestion: {query}",
                system_prompt="You are a helpful AI assistant. Always refer to the specific information from the provided context in your response."
            )
            print(f"\nFinal response: {response}")
            
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        print("Full traceback:")
        print(traceback.format_exc())

if __name__ == "__main__":
    main()