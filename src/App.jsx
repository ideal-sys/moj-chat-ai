import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [message, setMessage] = useState("");
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState("1:1");
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
    localStorage.setItem("mirus-ai-chats", JSON.stringify(chats));
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

  async function sendMessage() {
    if (!message.trim() || loading) return;

    let chatId = activeChatId;

    // Jeśli nie ma aktywnego czatu, tworzymy go
    if (!chatId) {
      const newChat = {
        id: Date.now(),
        title: message.trim().slice(0, 35),
        messages: [],
      };

      setChats((prev) => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      chatId = newChat.id;
    }

    const userMessage = message.trim();
    setMessage("");

    const currentChat = chats.find((chat) => chat.id === chatId);
    const currentMessages = currentChat?.messages || [];

    const updatedMessages = [
      ...currentMessages,
      {
        role: "user",
        text: userMessage,
      },
    ];

    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              title:
                chat.title === "Nowy czat"
                  ? userMessage.slice(0, 35)
                  : chat.title,
              messages: updatedMessages,
            }
          : chat
      )
    );

    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage,
          previousInteractionId: memoryInteractionId,
        }),
      });

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
          text: data.reply,
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

  async function generateImage() {
    if (!message.trim() || loading) return;

    let chatId = activeChatId;
    const prompt = message.trim();

    if (!chatId) {
      const newChat = { id: Date.now(), title: prompt.slice(0, 35), messages: [] };
      setChats((prev) => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      chatId = newChat.id;
    }

    const currentChat = chats.find((chat) => chat.id === chatId);
    const currentMessages = currentChat?.messages || [];
    const updatedMessages = [
      ...currentMessages,
      { role: "user", text: prompt, kind: "image-prompt" },
    ];

    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              title: chat.title === "Nowy czat" ? prompt.slice(0, 35) : chat.title,
              messages: updatedMessages,
            }
          : chat
      )
    );

    setMessage("");
    setLoading(true);

    try {
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, aspectRatio: imageAspectRatio }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Wystąpił błąd");

      const finalMessages = [
        ...updatedMessages,
        { role: "assistant", text: "Wygenerowany obraz", image: data.image, kind: "image" },
      ];

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId ? { ...chat, messages: finalMessages } : chat
        )
      );
    } catch (error) {
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [
                  ...updatedMessages,
                  { role: "assistant", text: "Wystąpił błąd: " + error.message },
                ],
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
      imageMode ? generateImage() : sendMessage();
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
              <h2>Witaj 👋</h2>
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
                {msg.image ? (
                  <div className="generated-image-wrap">
                    <img className="generated-image" src={msg.image} alt={msg.text || "Wygenerowany obraz"} />
                    <a className="download-image" href={msg.image} download={`mirus-ai-${Date.now()}.png`}>
                      Pobierz obraz
                    </a>
                  </div>
                ) : (
                  msg.text
                )}
              </div>
            ))
          )}

          {loading && (
            <div className="message assistant">
              {imageMode ? "Tworzę obraz..." : "Piszę..."}
            </div>
          )}
        </main>

        <div className="composer">
          <div className="mode-bar">
            <button
              className={`image-mode-button ${imageMode ? "active" : ""}`}
              onClick={() => setImageMode((prev) => !prev)}
              disabled={loading}
            >
              🖼️ {imageMode ? "Obraz włączony" : "Generuj obraz"}
            </button>

            {imageMode && (
              <select
                className="aspect-select"
                value={imageAspectRatio}
                onChange={(e) => setImageAspectRatio(e.target.value)}
                disabled={loading}
                aria-label="Proporcje obrazu"
              >
                <option value="1:1">1:1 kwadrat</option>
                <option value="16:9">16:9 poziomo</option>
                <option value="9:16">9:16 pionowo</option>
              </select>
            )}
          </div>

          <div className="input-area">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={imageMode ? "Opisz obraz, który mam stworzyć..." : "Napisz wiadomość..."}
              rows="1"
            />

            <button onClick={imageMode ? generateImage : sendMessage} disabled={loading}>
              {imageMode ? "Generuj" : "Wyślij"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;