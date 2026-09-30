import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [message, setMessage] = useState("");
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [loading, setLoading] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [mode, setMode] = useState("chat");

  useEffect(() => {
    try {
      const savedChats = localStorage.getItem("mirus-ai-chats");

      if (savedChats) {
        const parsedChats = JSON.parse(savedChats);

        if (Array.isArray(parsedChats)) {
          setChats(parsedChats);

          if (parsedChats.length > 0) {
            setActiveChatId(parsedChats[0].id);
          }
        }
      }
    } catch (error) {
      console.error("Nie udało się wczytać historii:", error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("mirus-ai-chats", JSON.stringify(chats));
    } catch (error) {
      console.warn(
        "Nie udało się zapisać historii. Wygenerowane obrazy mogą zajmować dużo miejsca w pamięci przeglądarki.",
        error
      );
    }
  }, [chats]);

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
    setMode("chat");
    setPlusMenuOpen(false);
    setSidebarOpen(false);
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

  function selectMode(nextMode) {
    setMode(nextMode);
    setPlusMenuOpen(false);
    setMessage("");
  }

  async function readJsonResponse(response) {
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      const text = await response.text();

      throw new Error(
        response.ok
          ? "Serwer zwrócił nieprawidłową odpowiedź."
          : `Serwer zwrócił błąd (${response.status}).`
      );
    }

    return response.json();
  }

  async function sendMessage() {
    if (!message.trim() || loading) return;

    let chatId = activeChatId;
    const userMessage = message.trim();

    if (!chatId) {
      const newChat = {
        id: Date.now(),
        title: userMessage.slice(0, 35),
        messages: [],
      };

      setChats((prev) => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      chatId = newChat.id;
    }

    setMessage("");
    setPlusMenuOpen(false);
    setLoading(true);

    const currentChat = chats.find((chat) => chat.id === chatId);
    const currentMessages = currentChat?.messages || [];

    const userEntry = {
      role: "user",
      text: userMessage,
    };

    const messagesWithUser = [...currentMessages, userEntry];

    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              title:
                chat.title === "Nowy czat"
                  ? userMessage.slice(0, 35)
                  : chat.title,
              messages: messagesWithUser,
            }
          : chat
      )
    );

    try {
      if (mode === "image") {
        const response = await fetch("/api/generate-image", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: userMessage,
          }),
        });

        const data = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error(
            data.error || "Nie udało się wygenerować obrazu."
          );
        }

        const finalMessages = [
          ...messagesWithUser,
          {
            role: "assistant",
            type: "image",
            image: data.image,
            text: data.text || "",
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
      } else {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: userMessage,
          }),
        });

        const data = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error(data.error || "Wystąpił błąd.");
        }

        const finalMessages = [
          ...messagesWithUser,
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
      }
    } catch (error) {
      const errorMessages = [
        ...messagesWithUser,
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
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <h2>Miruś AI</h2>

            <button
              className="sidebar-close"
              onClick={() => setSidebarOpen(false)}
              aria-label="Zamknij historię"
            >
              ×
            </button>
          </div>

          <button className="new-chat" onClick={createNewChat}>
            <span>＋</span>
            Nowy czat
          </button>
        </div>

        <div className="chat-history">
          {chats.length === 0 ? (
            <div className="empty-history">
              Twoje rozmowy pojawią się tutaj.
            </div>
          ) : (
            chats.map((chat) => (
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
                  aria-label="Usuń czat"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="main">
        <header className="header">
          <div className="header-left">
            <button
              className="menu-button"
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label="Historia czatów"
            >
              ☰
            </button>

            <h1>Miruś AI</h1>
          </div>

          <span>{mode === "image" ? "Generowanie obrazu" : "Gemini"}</span>
        </header>

        <main className="chat">
          {!activeChat || activeChat.messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-icon">
                {mode === "image" ? "✨" : "M"}
              </div>

              <h2>
                {mode === "image"
                  ? "Co mam dla Ciebie wygenerować?"
                  : "Witaj 👋"}
              </h2>

              <p>
                {mode === "image"
                  ? "Opisz obraz, a Miruś AI go stworzy."
                  : "W czym mogę Ci pomóc?"}
              </p>
            </div>
          ) : (
            activeChat.messages.map((msg, index) => (
              <div
                key={index}
                className={`message ${
                  msg.role === "user" ? "user" : "assistant"
                } ${msg.type === "image" ? "image-message" : ""}`}
              >
                {msg.type === "image" ? (
                  <div className="generated-image-wrap">
                    <img
                      src={msg.image}
                      alt="Wygenerowany obraz"
                      className="generated-image"
                    />

                    {msg.text && (
                      <div className="generated-image-caption">
                        {msg.text}
                      </div>
                    )}
                  </div>
                ) : (
                  msg.text
                )}
              </div>
            ))
          )}

          {loading && (
            <div className="message assistant typing-message">
              <span></span>
              <span></span>
              <span></span>
            </div>
          )}
        </main>

        <div className="input-area">
          <div className="input-wrapper">
            {plusMenuOpen && (
              <div className="plus-menu">
                <button
                  onClick={() => selectMode("image")}
                  className={mode === "image" ? "selected" : ""}
                >
                  <span className="plus-menu-icon">✨</span>

                  <span>
                    <strong>Generuj obraz</strong>
                    <small>Stwórz obraz z opisu</small>
                  </span>
                </button>

                <button
                  onClick={() => selectMode("chat")}
                  className={mode === "chat" ? "selected" : ""}
                >
                  <span className="plus-menu-icon">💬</span>

                  <span>
                    <strong>Rozmowa</strong>
                    <small>Porozmawiaj z Mirusiem</small>
                  </span>
                </button>
              </div>
            )}

            <button
              className={`plus-button ${plusMenuOpen ? "open" : ""}`}
              onClick={() => setPlusMenuOpen((prev) => !prev)}
              aria-label="Dodaj opcję"
            >
              +
            </button>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                mode === "image"
                  ? "Opisz obraz, który mam wygenerować..."
                  : "Napisz wiadomość..."
              }
              rows="1"
            />

            <button
              className="send-button"
              onClick={sendMessage}
              disabled={loading || !message.trim()}
              aria-label="Wyślij"
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
