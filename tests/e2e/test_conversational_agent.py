import pytest
from unittest.mock import Mock, patch
from Node.apps.conversational_agent.app import ConversationalAgent
from ubiq import NetworkScene, RoomClient

@pytest.fixture
def mock_scene():
    scene = Mock(spec=NetworkScene)
    scene.roomClient = Mock(spec=RoomClient)
    scene.roomClient.peers = Mock()
    return scene

@pytest.fixture
def conversational_agent(mock_scene):
    return ConversationalAgent(mock_scene, 'test-activity-id')

def test_agent_initialization(conversational_agent):
    assert conversational_agent.activityId == 'test-activity-id'
    assert conversational_agent.targetPeer == ''
    assert conversational_agent.components['mediaReceiver'] is not None
    assert conversational_agent.components['speech2text'] is not None
    assert conversational_agent.components['textGenerationService'] is not None
    assert conversational_agent.components['textToSpeechService'] is not None

def test_wake_word_detection(conversational_agent):
    # Test various wake words
    for wake_word in conversational_agent.WAKE_WORDS:
        assert conversational_agent.isWakeWord(wake_word)
    
    # Test non-wake words
    assert not conversational_agent.isWakeWord('random')
    assert not conversational_agent.isWakeWord('')
    assert not conversational_agent.isWakeWord('hello world')

@patch('Node.services.text_generation.service.TextGenerationService')
def test_full_conversation_flow(mock_text_gen, conversational_agent):
    # Mock text generation service
    mock_text_gen.return_value = Mock()
    mock_text_gen.return_value.on.return_value = None
    
    # Simulate audio input
    test_audio_data = b'test audio data'
    conversational_agent.components['mediaReceiver'].emit('audio', 'test-peer', test_audio_data)
    
    # Simulate STT response
    stt_response = {
        'content': 'hello agent',
        'peerName': 'User'
    }
    conversational_agent.components['speech2text'].emit('data', str(stt_response).encode(), 'default')
    
    # Verify text generation service was called
    assert conversational_agent.components['textGenerationService'].sendToChildProcess.called

def test_audio_processing(conversational_agent):
    # Test audio buffer management
    test_audio_data = b'test audio data'
    conversational_agent.components['mediaReceiver'].emit('audio', 'test-peer', test_audio_data)
    
    assert 'test-peer' in conversational_agent.speechBuffer
    assert len(conversational_agent.speechBuffer['test-peer']) > 0

def test_error_handling(conversational_agent):
    # Test handling of invalid audio data
    with pytest.raises(Exception):
        conversational_agent.components['mediaReceiver'].emit('audio', 'test-peer', None)
    
    # Test handling of invalid STT response
    with pytest.raises(Exception):
        conversational_agent.components['speech2text'].emit('data', b'invalid json', 'default') 