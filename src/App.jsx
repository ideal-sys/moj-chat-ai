import { useState } from "react";
import "./App.css";

function App() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  async function sendMessage() {
    if (!message.trim() || loading) return;

    const userMessage = message;
    setMessage("");

    setMessages((prev) => [
      ...prev,
      { role: "user", text: userMessage },
    ]);

    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Wystąpił błąd");
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.reply },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Wystąpił błąd: " + error.message,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Miruś AI</h1>
        <span>Gemini</span>
      </header>

      <main className="chat">
        {messages.length === 0 && (
          <div className="welcome">
            <h2>Witaj 👋</h2>
            <p>W czym mogę Ci pomóc?</p>
          </div>
        )}

        {messages.map((msg, index) => (
          <div
            key={index}
            className={`message ${
              msg.role === "user" ? "user" : "assistant"
            }`}
          >
            {msg.text}
          </div>
        ))}

        {loading && (
          <div className="message assistant">
            Piszę...
          </div>
        )}
      </main>

      <div className="input-area">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Napisz wiadomość..."
          rows="1"
        />

        <button onClick={sendMessage} disabled={loading}>
          Wyślij
        </button>
      </div>
    </div>
  );
}

export default App;