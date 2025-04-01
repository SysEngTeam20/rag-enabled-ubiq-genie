import pytest
from unittest.mock import Mock, patch
from Node.services.text_generation.rag_service import RAGService

@pytest.fixture
def mock_env_vars():
    with patch.dict('os.environ', {
        'API_SECRET_KEY': 'test_secret',
        'API_BASE_URL': 'http://test-api:3000',
        'ACTIVITY_ID': 'test-activity-id'
    }):
        yield

@pytest.fixture
def rag_service(mock_env_vars):
    return RAGService(
        api_secret_key='test_secret',
        api_base_url='http://test-api:3000',
        activity_id='test-activity-id'
    )

def test_rag_service_initialization(rag_service):
    assert rag_service.api_secret_key == 'test_secret'
    assert rag_service.api_base_url == 'http://test-api:3000'
    assert rag_service.activity_id == 'test-activity-id'

@patch('requests.get')
def test_fetch_documents(mock_get, rag_service):
    mock_response = Mock()
    mock_response.status_code = 200
    mock_response.json.return_value = [
        {'url': 'http://test.com/doc1', 'name': 'doc1'},
        {'url': 'http://test.com/doc2', 'name': 'doc2'}
    ]
    mock_get.return_value = mock_response

    docs = rag_service.fetch_documents('test-activity-id')
    assert len(docs) == 2
    assert docs[0]['name'] == 'doc1'
    assert docs[1]['name'] == 'doc2'

@patch('requests.get')
def test_load_document(mock_get, rag_service):
    mock_response = Mock()
    mock_response.ok = True
    mock_response.text = 'Test document content'
    mock_get.return_value = mock_response

    content = rag_service.load_document('http://test.com/doc1')
    assert content == 'Test document content'

@patch('requests.post')
def test_query_ollama(mock_post, rag_service):
    mock_response = Mock()
    mock_response.ok = True
    mock_response.json.return_value = {'response': 'Test LLM response'}
    mock_post.return_value = mock_response

    response = rag_service.query_ollama(
        prompt='test query',
        context='test context',
        system_prompt='test system prompt'
    )
    assert response == 'Test LLM response'

def test_get_context_for_query(rag_service):
    # Mock vectorstore
    rag_service.vectorstore = Mock()
    mock_docs = [
        Mock(page_content='doc1 content'),
        Mock(page_content='doc2 content')
    ]
    rag_service.vectorstore.similarity_search.return_value = mock_docs

    context = rag_service.get_context_for_query('test query')
    assert context == 'doc1 content\ndoc2 content' 