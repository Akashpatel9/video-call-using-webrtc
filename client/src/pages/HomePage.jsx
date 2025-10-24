import React from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";

export default function HomePage() {
  const navigate = useNavigate();

  const styles = {
    page: {
      height: "100vh",
      width: "100vw",
      background: "#0f1724",
      color: "#e6eef8",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      fontFamily: "Inter, Roboto, sans-serif",
    },
    card: {
      background: "#0b1220",
      border: "1px solid #1e2a44",
      borderRadius: "10px",
      padding: "40px",
      textAlign: "center",
      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      width: "320px",
    },
    title: {
      fontSize: "22px",
      fontWeight: "600",
      marginBottom: "12px",
    },
    subtitle: {
      color: "#9fb4d9",
      fontSize: "14px",
      marginBottom: "20px",
      lineHeight: "1.4em",
    },
    button: {
      background: "#1f6feb",
      color: "#fff",
      border: "none",
      borderRadius: "6px",
      padding: "10px 16px",
      fontSize: "15px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "background 0.2s",
    },
    buttonHover: {
      background: "#3182f6",
    },
    linkBox: {
      marginTop: "20px",
      fontSize: "13px",
      color: "#9fb4d9",
    },
    input: {
      width: "100%",
      padding: "8px",
      marginTop: "8px",
      borderRadius: "6px",
      border: "1px solid #2a3d5f",
      background: "#0b1424",
      color: "#e6eef8",
    },
  };

  const handleCreateRoom = () => {
    const roomID = uuidv4();
    navigate(`/meet/${roomID}`);
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.title}>Start a Video Meeting</div>
        <div style={styles.subtitle}>
          Instantly create a private video room and share the link with others.
        </div>
        <button
          style={styles.button}
          onMouseEnter={(e) => (e.target.style.background = styles.buttonHover.background)}
          onMouseLeave={(e) => (e.target.style.background = styles.button.background)}
          onClick={handleCreateRoom}
        >
          Create New Room
        </button>
      </div>

      <div style={styles.linkBox}>
        Or, if you already have a room link, paste it in your browser’s address bar.
      </div>
    </div>
  );
}
