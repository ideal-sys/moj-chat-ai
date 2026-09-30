import { useEffect, useRef, useState } from "react";
import "./App.css";

function App() {
  const [message, setMessage] = useState("");
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [mode, setMode] = useState("chat");
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);
  // ID ostatniej interakcji Gemini. Dzięki temu Gemini może pamiętać
  // wcześniejsze rozmowy także po zamknięciu strony.
  const [memoryInteractionId, setMemoryInteractionId] = useState(
    () => localStorage.getItem("mirus-ai-memory-id") || null
  );

  // Wczytanie zapisanych czatów
  useEffect(() => {
    const savedChats = localStorage.getItem("mirus-ai-chats");

    if (savedChats) {
      const parsedChats = JSON.parse(savedChats);
      setChats(parsedChats);

      if (parsedChats.length > 0) {
        setActiveChatId(parsedChats[0].id);
      }
    }
  }, []);

  // Automatyczne zapisywanie
  useEffect(() => {
    try {
      localStorage.setItem("mirus-ai-chats", JSON.stringify(chats));
    } catch (error) {
      console.warn("Historia jest zbyt duża, aby zapisać ją w localStorage.", error);
    }
  }, [chats]);

  // Zapamiętujemy identyfikator rozmowy po stronie Gemini.
  useEffect(() => {
    if (memoryInteractionId) {
      localStorage.setItem("mirus-ai-memory-id", memoryInteractionId);
    } else {
      localStorage.removeItem("mirus-ai-memory-id");
    }
  }, [memoryInteractionId]);

  function clearAiMemory() {
    setMemoryInteractionId(null);
    localStorage.removeItem("mirus-ai-memory-id");
  }

  const activeChat = chats.find((chat) => chat.id === activeChatId);

  function createNewChat() {
    const newChat = {
      id: Date.now(),
      title: "Nowy czat",
      messages: [],
    };

    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setMessage("");
    setSelectedFile(null);
    setMode("chat");
    setPlusMenuOpen(false);
  }

  function deleteChat(id) {
    const remainingChats = chats.filter((chat) => chat.id !== id);

    setChats(remainingChats);

    if (activeChatId === id) {
      if (remainingChats.length > 0) {
        setActiveChatId(remainingChats[0].id);
      } else {
        setActiveChatId(null);
      }
    }
  }

  function updateMessages(newMessages) {
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === activeChatId
          ? {
              ...chat,
              messages: newMessages,
              title:
                chat.title === "Nowy czat" && newMessages.length > 0
                  ? newMessages[0].text.slice(0, 35)
                  : chat.title,
            }
          : chat
      )
    );
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function chooseFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      alert("Plik jest za duży. Maksymalny rozmiar to 15 MB.");
      e.target.value = "";
      return;
    }
    setSelectedFile(file);
    setMode("file");
    setPlusMenuOpen(false);
  }

  async function sendMessage() {
    if ((!message.trim() && !selectedFile) || loading) return;

    let chatId = activeChatId;

    // Jeśli nie ma aktywnego czatu, tworzymy go
    if (!chatId) {
      const newChat = {
        id: Date.now(),
        title: (message.trim() || selectedFile?.name || "Nowy czat").slice(0, 35),
        messages: [],
      };

      setChats((prev) => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      chatId = newChat.id;
    }

    const userMessage = message.trim();
    const fileForRequest = selectedFile;
    const currentMode = mode;
    setMessage("");
    setSelectedFile(null);
    setMode("chat");
    setPlusMenuOpen(false);

    const currentChat = chats.find((chat) => chat.id === chatId);
    const currentMessages = currentChat?.messages || [];

    const updatedMessages = [
      ...currentMessages,
      {
        role: "user",
        text: userMessage || (fileForRequest ? "Przeanalizuj ten plik" : ""),
        attachmentName: fileForRequest?.name || null,
      },
    ];

    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              title:
                chat.title === "Nowy czat"
                  ? (userMessage || fileForRequest?.name || "Nowy czat").slice(0, 35)
                  : chat.title,
              messages: updatedMessages,
            }
          : chat
      )
    );

    setLoading(true);

    try {
      let response;
      if (currentMode === "image") {
        response = await fetch("/api/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: userMessage }),
        });
      } else {
        let filePayload = null;
        if (fileForRequest) {
          filePayload = {
            name: fileForRequest.name,
            mimeType: fileForRequest.type || "application/octet-stream",
            data: await fileToBase64(fileForRequest),
          };
        }
        response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userMessage,
            previousInteractionId: memoryInteractionId,
            file: filePayload,
          }),
        });
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Wystąpił błąd");
      }

      if (data.interactionId) {
        setMemoryInteractionId(data.interactionId);
      }

      const finalMessages = [
        ...updatedMessages,
        {
          role: "assistant",
          text: data.reply || (data.image ? "Gotowe — wygenerowałem obraz." : ""),
          image: data.image || null,
        },
      ];

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: finalMessages,
              }
            : chat
        )
      );
    } catch (error) {
      const errorMessages = [
        ...updatedMessages,
        {
          role: "assistant",
          text: "Wystąpił błąd: " + error.message,
        },
      ];

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: errorMessages,
              }
            : chat
        )
      );
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

      {/* PANEL HISTORII */}
      {sidebarOpen && (
  <div
    className="sidebar-overlay"
    onClick={() => setSidebarOpen(false)}
  />
)}

      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <h2>Miruś AI</h2>

          <button
  className="new-chat"
  onClick={() => {
    createNewChat();
    setSidebarOpen(false);
  }}
>
  + Nowy czat
</button>

          <button
            className="new-chat"
            onClick={() => {
              clearAiMemory();
              setSidebarOpen(false);
            }}
            title="Usuwa pamięć kontekstu Gemini. Historia czatów pozostaje."
          >
            🧠 Wyczyść pamięć AI
          </button>
        </div>

        <div className="chat-history">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`history-item ${
                chat.id === activeChatId ? "active" : ""
              }`}
              onClick={() => {
  setActiveChatId(chat.id);
  setSidebarOpen(false);
}}
            >
              <span>{chat.title}</span>

              <button
                className="delete-chat"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteChat(chat.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* GŁÓWNA CZĘŚĆ */}
      <div className="main">

        <header className="header">
  <div className="header-left">
    <button
      className="menu-button"
      onClick={() => setSidebarOpen(!sidebarOpen)}
      aria-label="Historia czatów"
    >
      ☰
    </button>

    <h1>Miruś AI</h1>
  </div>

  <span>Gemini</span>
</header>

        <main className="chat">

          {!activeChat || activeChat.messages.length === 0 ? (
            <div className="welcome">
              <h2>Witaj Mireczku👋</h2>
              <p>W czym mogę Ci pomóc?</p>
            </div>
          ) : (
            activeChat.messages.map((msg, index) => (
              <div
                key={index}
                className={`message ${
                  msg.role === "user" ? "user" : "assistant"
                }`}
              >
                {msg.attachmentName && <div className="message-attachment">📎 {msg.attachmentName}</div>}
                {msg.text}
                {msg.image && (
                  <div className="generated-image-wrap">
                    <img className="generated-image" src={msg.image} alt="Obraz wygenerowany przez AI" />
                    <a className="image-download" href={msg.image} download="mirus-ai.png">Pobierz obraz</a>
                  </div>
                )}
              </div>
            ))
          )}

          {loading && (
            <div className="message assistant">
              Piszę...
            </div>
          )}
        </main>

        <div className="input-area">
          <div className="composer">
            {selectedFile && (
              <div className="selected-file">
                <span>📎 {selectedFile.name}</span>
                <button type="button" onClick={() => { setSelectedFile(null); setMode("chat"); }} aria-label="Usuń plik">×</button>
              </div>
            )}
            {mode === "image" && !selectedFile && (
              <div className="mode-chip">🖼️ Generowanie obrazu <button type="button" onClick={() => setMode("chat")}>×</button></div>
            )}
            <div className="composer-row">
              <div className="plus-wrap">
                <button type="button" className="plus-button" onClick={() => setPlusMenuOpen((v) => !v)} aria-label="Dodaj" aria-expanded={plusMenuOpen}>+</button>
                {plusMenuOpen && (
                  <div className="plus-menu">
                    <button type="button" onClick={() => { setMode("image"); setSelectedFile(null); setPlusMenuOpen(false); }}>🖼️ <span>Generuj obraz</span></button>
                    <button type="button" onClick={() => fileInputRef.current?.click()}>📎 <span>Dodaj plik</span></button>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} className="hidden-file-input" type="file" accept="image/*,.pdf,.txt,.csv,.json,.xml" onChange={chooseFile} />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={mode === "image" ? "Opisz obraz, który mam wygenerować..." : selectedFile ? "Napisz, co mam sprawdzić w pliku..." : "Napisz wiadomość..."}
                rows="1"
              />
              <button className="send-button" onClick={sendMessage} disabled={loading || (!message.trim() && !selectedFile)}>
                {mode === "image" ? "Generuj" : "Wyślij"}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;