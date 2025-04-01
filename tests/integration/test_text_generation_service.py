import pytest
from unittest.mock import Mock, patch
from Node.services.text_generation.service import TextGenerationService
from ubiq import NetworkScene

@pytest.fixture
def mock_scene():
    return Mock(spec=NetworkScene)

@pytest.fixture
def text_generation_service(mock_scene):
    return TextGenerationService(mock_scene, 'test-activity-id')

def test_service_initialization(text_generation_service):
    assert text_generation_service.activityId == 'test-activity-id'
    assert 'default' in text_generation_service.childProcesses

def test_process_communication(text_generation_service):
    # Mock the child process
    mock_process = text_generation_service.childProcesses['default']
    
    # Simulate receiving data from the Python process
    test_data = b'Agent -> User:: Test response'
    mock_process.stdout.on('data')(test_data)
    
    # Verify the data was emitted
    emitted_data = []
    text_generation_service.on('data', lambda data, _: emitted_data.append(data))
    
    assert len(emitted_data) == 1
    assert emitted_data[0] == test_data

@patch('requests.post')
def test_error_handling(mock_post, text_generation_service):
    # Simulate LLM server error
    mock_post.side_effect = Exception('LLM server error')
    
    # Send test message
    test_message = {
        'content': 'test query',
        'peerName': 'User'
    }
    
    # Verify error handling
    with pytest.raises(Exception) as exc_info:
        text_generation_service.sendToChildProcess('default', str(test_message).encode())
    
    assert 'LLM server error' in str(exc_info.value)

def test_process_lifecycle(text_generation_service):
    mock_process = text_generation_service.childProcesses['default']
    
    # Test process startup
    assert mock_process.pid is not None
    assert not mock_process.killed
    
    # Test process shutdown
    text_generation_service.shutdown()
    assert mock_process.killed 