import { EventEmitter } from 'node:events';
import { PeerConnectionManager } from 'ubiq-server/components/peerconnectionmanager.js';

// We use the @roamhq/wrtc package as the regular wrtc package has been abandoned :(
import wrtc from '@roamhq/wrtc';
import { RTCAudioData, RTCVideoData } from '@roamhq/wrtc/types/nonstandard';
const { RTCPeerConnection, nonstandard, MediaStream } = wrtc;
const { RTCAudioSink, RTCVideoSink } = nonstandard;

export class MediaReceiver extends EventEmitter {
    context: any;
    peerConnectionManager: PeerConnectionManager;

    constructor(scene: any) {
        super();
        this.peerConnectionManager = new PeerConnectionManager(scene);

        this.peerConnectionManager.addListener('OnPeerConnectionRemoved', (component) => {
            for (let element of component.elements) {
                element.remove();
            }
        });

        this.peerConnectionManager.addListener('OnPeerConnection', async (component) => {
            let pc = new RTCPeerConnection({
                iceServers: [
                    {
                        urls: [
                            'stun:stun.l.google.com:19302',
                            'stun:stun1.l.google.com:19302',
                            'stun:stun2.l.google.com:19302'
                        ]
                    }
                ],
                iceTransportPolicy: 'all',
                bundlePolicy: 'max-bundle',
                rtcpMuxPolicy: 'require',
                iceCandidatePoolSize: 0
            });

            // Add transceivers to receive audio
            const stream = new MediaStream();
            const transceiver = pc.addTransceiver('audio', {
                direction: 'recvonly',
                streams: [stream]
            });

            // Ensure transceiver is properly configured
            transceiver.direction = 'recvonly';

            component.elements = [];

            component.makingOffer = false;
            component.ignoreOffer = false;
            component.isSettingRemoteAnswerPending = false;
            component.hasRenegotiated = false;

            // Special handling for dotnet peers
            component.otherPeerId = undefined;

            pc.onicecandidate = ({ candidate }) => {
                component.sendIceCandidate(candidate);
            };

            pc.oniceconnectionstatechange = () => {
                // If ICE fails, try restarting ICE
                if (pc.iceConnectionState === 'failed') {
                    pc.restartIce();
                }
            };

            pc.onconnectionstatechange = () => {};
            pc.onsignalingstatechange = () => {};
            pc.onnegotiationneeded = async () => {
                try {
                    component.makingOffer = true;
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    component.sendSdp(pc.localDescription);
                } catch (err) {
                    console.error(`[MediaReceiver] Error creating offer:`, err);
                } finally {
                    component.makingOffer = false;
                }
            };

            // Ensure we have a polite peer
            component.polite = true;

            component.addListener(
                'OnSignallingMessage',
                async (m: {
                    implementation: any;
                    type: any;
                    sdp: any;
                    candidate: any;
                    sdpMid: any;
                    sdpMLineIndex: any;
                    usernameFragment: any;
                }) => {
                    // Special handling for dotnet peers
                    if (component.otherPeerId === undefined) {
                        component.otherPeerId = m.implementation ? m.implementation : 'unknown';
                    }

                    let description = m.type
                        ? {
                              type: m.type,
                              sdp: m.sdp,
                          }
                        : undefined;

                    let candidate = m.candidate
                        ? {
                              candidate: m.candidate,
                              sdpMid: m.sdpMid,
                              sdpMLineIndex: m.sdpMLineIndex,
                              usernameFragment: m.usernameFragment,
                          }
                        : undefined;

                    try {
                        if (description) {
                            const readyForOffer =
                                !component.makingOffer &&
                                (pc.signalingState == 'stable' || component.isSettingRemoteAnswerPending);
                            const offerCollision = description.type == 'offer' && !readyForOffer;

                            component.ignoreOffer = !component.polite && offerCollision;
                            if (component.ignoreOffer) {
                                return;
                            }
                            component.isSettingRemoteAnswerPending = description.type == 'answer';
                            await pc.setRemoteDescription(description);
                            component.isSettingRemoteAnswerPending = false;
                            if (description.type == 'offer') {
                                const answer = await pc.createAnswer();
                                await pc.setLocalDescription(answer);
                                component.sendSdp(answer);
                            } else if (description.type === 'answer') {
                                if (!component.hasRenegotiated) {
                                    component.hasRenegotiated = true;
                                    setTimeout(async () => {
                                        const offer = await pc.createOffer();
                                        await pc.setLocalDescription(offer);
                                        component.sendSdp(offer);
                                    }, 1000);
                                }
                            }
                        } else if (candidate) {
                            try {
                                await pc.addIceCandidate(candidate);
                            } catch (e: any) {
                                console.error(`[MediaReceiver] Error adding ICE candidate:`, e.message);
                            }
                        }
                    } catch (err) {
                        console.error(`[MediaReceiver] Error processing signaling message:`, err);
                    }
                }
            );

            pc.ontrack = ({ track, streams }) => {
                switch (track.kind) {
                    case 'audio':
                        let audioSink = new RTCAudioSink(track);
                        audioSink.ondata = (data: RTCAudioData) => {
                            this.emit('audio', component.uuid, data);
                        };
                        break;
                    case 'video':
                        let videoSink = new RTCVideoSink(track);
                        videoSink.onframe = (frame: RTCVideoData) => {
                            this.emit('video', component.uuid, frame);
                        };
                }
            };
        });
    }
}
