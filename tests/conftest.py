import pytest
import os
from pathlib import Path

@pytest.fixture(autouse=True)
def setup_test_env():
    """Setup test environment variables"""
    test_env = {
        'API_SECRET_KEY': 'test_secret_key',
        'API_BASE_URL': 'http://test-api:3000',
        'LLM_SERVER': 'http://test-llm:8080',
        'LLM_PORT': '8080',
        'ACTIVITY_ID': 'test-activity-id',
        'WEBSOCKET_SERVER_URL': 'ws://test-ws:5001'
    }
    
    # Store original environment
    original_env = dict(os.environ)
    
    # Set test environment
    for key, value in test_env.items():
        os.environ[key] = value
    
    yield
    
    # Restore original environment
    os.environ.clear()
    os.environ.update(original_env)

@pytest.fixture
def test_data_dir():
    """Get the test data directory"""
    return Path(__file__).parent / 'data'

@pytest.fixture
def mock_documents(test_data_dir):
    """Load mock documents for testing"""
    return [
        {
            'url': 'http://test.com/doc1',
            'name': 'test_doc1',
            'content': 'This is a test document about quantum computing.'
        },
        {
            'url': 'http://test.com/doc2',
            'name': 'test_doc2',
            'content': 'This is another test document about quantum entanglement.'
        }
    ] 