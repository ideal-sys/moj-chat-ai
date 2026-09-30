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
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

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
  system_instruction: "Zawsze odpowiadaj po polsku. Używaj naturalnego, poprawnego języka polskiego.",
  input: message,
});

    res.json({
      reply: interaction.output_text,
    });
  } catch (error) {
    console.error("GEMINI ERROR:", error);

    res.status(500).json({
      error: "Nie udało się uzyskać odpowiedzi od Gemini.",
    });
  }
});

// Gotowa aplikacja React
const distPath = path.join(__dirname, "..", "dist");

app.use(express.static(distPath));

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend działa na porcie ${PORT}`);
});