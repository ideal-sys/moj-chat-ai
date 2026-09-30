import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/* =========================
   ZWYKŁA ROZMOWA
   ========================= */

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Wiadomość jest pusta.",
      });
    }

    const interaction = await ai.interactions.create({
      model: "gemini-3.5-flash-lite",
      system_instruction:
        "Zawsze odpowiadaj po polsku. Używaj naturalnego, poprawnego języka polskiego.",
      input: message.trim(),
    });

    res.json({
      reply:
        interaction.output_text ||
        "Nie udało się uzyskać odpowiedzi.",
    });
  } catch (error) {
    console.error("GEMINI CHAT ERROR:", error);

    res.status(500).json({
      error: "Nie udało się uzyskać odpowiedzi od Gemini.",
    });
  }
});

/* =========================
   GENEROWANIE OBRAZU
   ========================= */

app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        error: "Opis obrazu jest pusty.",
      });
    }

    const interaction = await ai.interactions.create({
      model: "gemini-3.1-flash-image",
      input: `Wygeneruj obraz na podstawie poniższego opisu. Nie dodawaj niepotrzebnego tekstu. Zachowaj możliwie dokładnie intencję użytkownika.

Opis:
${prompt.trim()}`,
      response_format: {
        type: "image",
        mime_type: "image/png",
        aspect_ratio: "1:1",
        image_size: "1K",
      },
    });

    const generatedImage = interaction.output_image;

    if (!generatedImage || !generatedImage.data) {
      return res.status(500).json({
        error: "Gemini nie zwróciło obrazu.",
      });
    }

    const mimeType = generatedImage.mime_type || "image/png";

    res.json({
      image: `data:${mimeType};base64,${generatedImage.data}`,
      text: interaction.output_text || "",
    });
  } catch (error) {
    console.error("GEMINI IMAGE ERROR:", error);

    res.status(500).json({
      error: "Nie udało się wygenerować obrazu. Sprawdź limit i dostęp do modelu obrazowego Gemini.",
    });
  }
});

/* =========================
   FRONTEND
   ========================= */

const distPath = path.join(__dirname, "..", "dist");

app.use(express.static(distPath));

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend działa na porcie ${PORT}`);
});
