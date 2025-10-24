import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import MeetPage from "./pages/MeetPage";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/meet/:id" element={<MeetPage />} />
      </Routes>
    </Router>
  );
}
