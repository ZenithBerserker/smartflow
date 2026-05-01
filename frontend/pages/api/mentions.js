import { getLiveMentions } from "../../lib/server/socialMentions";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const data = await getLiveMentions({ force: req.query.force === "1" });
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message, timestamp: Date.now() });
  }
}
