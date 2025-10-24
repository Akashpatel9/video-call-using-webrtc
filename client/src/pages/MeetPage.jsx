import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import "./MeetPage.css";

const SIGNALING_SERVER_URL = "http://localhost:8000"; // adjust if different

export default function MeetPage() {
  const { id: roomID } = useParams();
  const navigate = useNavigate();

  const localVideoRef = useRef(null);
  const peersRef = useRef({}); // socketId -> RTCPeerConnection
  const remoteStreamsRef = useRef({}); // socketId -> MediaStream
  const socketRef = useRef(null);

  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]); // array of { id, stream }
  const [status, setStatus] = useState("initializing");


  // Helpers to update remote streams state in React when remoteStreamsRef changes
  const pushRemoteStream = (id, stream) => {
    remoteStreamsRef.current[id] = stream;
    const arr = Object.keys(remoteStreamsRef.current).map((sid) => ({
      id: sid,
      stream: remoteStreamsRef.current[sid],
    }));
    setRemoteStreams(arr);
  };

  const removeRemoteStream = (id) => {
    delete remoteStreamsRef.current[id];
    const arr = Object.keys(remoteStreamsRef.current).map((sid) => ({
      id: sid,
      stream: remoteStreamsRef.current[sid],
    }));
    setRemoteStreams(arr);
  };

  useEffect(() => {
    let mounted = true;

    async function start() {
      setStatus("getting media");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { width: 1280, height: 720 },
        });

        if (!mounted) return;
        setLocalStream(stream);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        // Connect to signaling server
        socketRef.current = io(SIGNALING_SERVER_URL, { transports: ["websocket"], reconnection: false });

        socketRef.current.on("connect", () => {
          setStatus("connected to signaling server");
          // join the room
          socketRef.current.emit("join room", roomID);
        });

        // List of existing users in the room (their socketIds)
        socketRef.current.on("all users", (users) => {
          setStatus(`creating offers to ${users.length} user(s)`);
          // Create offer to each existing user
          users.forEach((userID) => {
            createOfferForUser(userID, stream);
          });
        });

        // When an existing client sends you a signal (a caller created an offer)
        socketRef.current.on("user joined", async ({ signal, callerID }) => {
          setStatus(`received offer from ${callerID}`);
          await handleIncomingSignal(signal, callerID, stream, false);
        });

        // When a caller receives your answer (returned signal)
        socketRef.current.on("receiving returned signal", async ({ signal, id }) => {
          setStatus(`received answer from ${id}`);
          const pc = peersRef.current[id];
          if (!pc) {
            console.warn("No peer connection found for", id);
            return;
          }
          // If signal is an SDP answer
          if (signal && signal.type === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
          } else if (signal && signal.candidate) {
            // ICE candidate
            try {
              await pc.addIceCandidate(new RTCIceCandidate(signal));
            } catch (e) {
              console.warn("Error adding ICE candidate", e);
            }
          }
        });

        socketRef.current.on("user left", (socketId) => {
          setStatus(`${socketId} left`);
          const pc = peersRef.current[socketId];
          if (pc) {
            try { pc.close(); } catch (e) {}
            delete peersRef.current[socketId];
          }
          removeRemoteStream(socketId);
        });

        // Keep any socket errors visible
        socketRef.current.on("connect_error", (err) => {
          console.error("Socket connect_error", err);
          setStatus("socket connect error");
        });
        socketRef.current.on("error", (err) => {
          console.error("Socket error", err);
        });

        setStatus("ready");
      } catch (err) {
        console.error("getUserMedia error:", err);
        setStatus("failed to get media");
        alert("Could not access camera/microphone. Check permissions.");
      }
    }

    start();

    return () => {
      mounted = false;
      // cleanup local stream
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }
      // close peers
      Object.values(peersRef.current || {}).forEach((pc) => {
        try { pc.close(); } catch (e) {}
      });
      // disconnect socket
      if (socketRef.current) {
        try { socketRef.current.disconnect(); } catch (e) {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once

  // Create a new RTCPeerConnection and create offer (for existing users)
  async function createOfferForUser(userToSignal, stream) {
    const pc = createPeerConnection(userToSignal);

    // Add local tracks
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    peersRef.current[userToSignal] = pc;

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send the SDP offer via signaling server
      socketRef.current.emit("sending signal", {
        userToSignal,
        callerID: socketRef.current.id,
        signal: pc.localDescription, // offer
      });
    } catch (err) {
      console.error("Error creating offer for", userToSignal, err);
    }
  }

  // When someone sends us a signal (offer or ICE), we need to set up PC and reply
  async function handleIncomingSignal(signal, callerID, stream, isInitiator = false) {
    // If there's already a PC for this caller, reuse it
    let pc = peersRef.current[callerID];
    if (!pc) {
      pc = createPeerConnection(callerID);
      // add local tracks
      if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      peersRef.current[callerID] = pc;
    }

    // If it's an offer
    if (signal && signal.type === "offer") {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Send back the answer
        socketRef.current.emit("returning signal", {
          callerID,
          signal: pc.localDescription, // answer
        });
      } catch (err) {
        console.error("Error handling offer from", callerID, err);
      }
    } else if (signal && signal.candidate) {
      // ICE candidate
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal));
      } catch (err) {
        console.warn("Error adding remote ICE candidate", err);
      }
    }
  }

  // Create RTCPeerConnection with events wired to signaling
  function createPeerConnection(peerSocketId) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        // add TURN here if you have one for production
      ],
    });

    // When local ICE candidate is found, send to remote peer via signaling server
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // send candidate as a "signal" (candidate object)
        socketRef.current.emit("sending signal", {
          userToSignal: peerSocketId,
          callerID: socketRef.current.id,
          signal: event.candidate,
        });
      }
    };

    // When a remote track arrives, attach it
    pc.ontrack = (event) => {
      // event.streams might be available
      const remoteStream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream();
      // If tracks came without streams, add tracks manually
      if (remoteStream && remoteStream.id) {
        pushRemoteStream(peerSocketId, remoteStream);
      } else {
        // fallback: collect tracks
        const stream = remoteStreamsRef.current[peerSocketId] || new MediaStream();
        event.track && stream.addTrack(event.track);
        pushRemoteStream(peerSocketId, stream);
      }
    };

    // Monitor connection state
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        // remove
        try { pc.close(); } catch (e) {}
        delete peersRef.current[peerSocketId];
        removeRemoteStream(peerSocketId);
      }
    };

    return pc;
  }

  // UI controls
  const handleLeave = () => {
    // cleanup and go back
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    Object.values(peersRef.current).forEach((pc) => {
      try { pc.close(); } catch (e) {}
    });
    peersRef.current = {};
    remoteStreamsRef.current = {};
    setRemoteStreams([]);
    if (socketRef.current) {
      try { socketRef.current.disconnect(); } catch (e) {}
    }
    navigate("/");
  };

  const toggleMuteAudio = () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setLocalStream((s) => s); // force update
    }
  };

  const toggleCamera = () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setLocalStream((s) => s);
    }
  };

  return (
    <div className="meet-page">
      <div className="meet-header">
        <div>
          <div className="meet-title">Video Meet</div>
          <div className="meet-room">Room: {roomID}</div>
        </div>
        <div className="meet-controls">
          <button className="btn-copy" onClick={() => navigator.clipboard?.writeText(window.location.href)}>
            Copy link
          </button>
          <button className="btn-leave" onClick={handleLeave}>
            Leave
          </button>
        </div>
      </div>

      <div className="meet-container">
        <div className="meet-left-panel">
          <div className="panel-title">Local</div>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="local-video"
          />
          <div className="video-controls">
            <button className="btn-secondary" onClick={toggleMuteAudio}>
              Toggle Mute
            </button>
            <button className="btn-secondary" onClick={toggleCamera}>
              Toggle Camera
            </button>
            <div className="status-indicator">
              {status}
            </div>
          </div>

          <div className="tips-section">
            Tips: Open the same room link in another tab or share with friends to start a call.
          </div>
        </div>

        <div className="meet-right-panel">
          <div className="panel-title">Participants</div>

          <div className="remote-grid">
            {remoteStreams.length === 0 && (
              <div className="empty-state">No remote participants yet.</div>
            )}

            {remoteStreams.map((r) => (
              <div key={r.id} className="remote-video-card">
                <video
                  autoPlay
                  playsInline
                  ref={(el) => {
                    if (el && r.stream) el.srcObject = r.stream;
                  }}
                  className="remote-video"
                />
                <div className="participant-label">Peer: {r.id}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="meet-footer">
        Built with WebRTC · Signaling via Socket.IO
      </div>
    </div>
  );
}
