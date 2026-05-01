import { getZscores } from "../../lib/server/zscores";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const data = await getZscores();
    res.status(200).json({ ...data, timestamp: Date.now() });
  } catch (e) {
    res.status(500).json({ tickers: [], timestamp: Date.now(), error: e.message });
  }
}
