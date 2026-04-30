# SMARTFLOW — Free Altcoin Momentum Engine

A fully free, deployable altcoin social momentum + smart money wallet tracker.
No paid APIs required to get started.

---

## What this does

1. **Scrapes** 4chan /biz/, Reddit, and Telegram for altcoin mention spikes
2. **Detects** statistically anomalous Z-score events (social hype)
3. **Validates** on-chain via DEXScreener (free, no key needed)
4. **Analyzes** top trader wallets using Google Gemini AI (free tier)
5. **Displays** everything in a live Next.js dashboard

---

## Free stack

| Layer | Service | Cost |
|---|---|---|
| Social scraping | 4chan API + Reddit API + Telegram | Free |
| On-chain data | DEXScreener public API | Free |
| AI wallet analysis | Google Gemini 1.5 Flash | Free |
| Frontend hosting | Vercel | Free |
| Backend/scrapers | Vercel serverless functions | Free |
| Code repo | GitHub | Free |

---

## Setup (step by step)

### 1. Get your free API keys

#### Google Gemini (AI analysis — required)
1. Go to https://aistudio.google.com/app/apikey
2. Click **Create API key**
3. Copy it — this is your `GEMINI_API_KEY`

#### Telegram (optional but recommended)
1. Go to https://my.telegram.org/auth
2. Log in with your phone number
3. Click **API development tools**
4. Create a new app — copy `api_id` and `api_hash`
5. These become `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`

#### Reddit (optional)
1. Go to https://www.reddit.com/prefs/apps
2. Click **create another app** → select **script**
3. Fill in name/description, set redirect to `http://localhost`
4. Copy `client_id` (under app name) and `client_secret`

---

### 2. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/smartflow.git
cd smartflow

# Install Python dependencies (scrapers)
pip install -r requirements.txt

# Install Node dependencies (frontend)
cd public
npm install
```

---

### 3. Set environment variables

Create a `.env.local` file in the `public/` folder:

```env
GEMINI_API_KEY=your_gemini_key_here
TELEGRAM_API_ID=your_telegram_api_id
TELEGRAM_API_HASH=your_telegram_api_hash
REDDIT_CLIENT_ID=your_reddit_client_id
REDDIT_CLIENT_SECRET=your_reddit_client_secret
```

Create a `.env` file in the root folder (for Python scrapers):

```env
GEMINI_API_KEY=your_gemini_key_here
TELEGRAM_API_ID=your_telegram_api_id
TELEGRAM_API_HASH=your_telegram_api_hash
REDDIT_CLIENT_ID=your_reddit_client_id
REDDIT_CLIENT_SECRET=your_reddit_client_secret
```

---

### 4. Run locally

**Option A — run everything together:**
```bash
# Terminal 1: start scrapers
python scrapers/run_all.py

# Terminal 2: start frontend
cd public && npm run dev
```

Open http://localhost:3000

**Option B — frontend only (uses mock data, no keys needed):**
```bash
cd public && npm run dev
```

---

### 5. Deploy to Vercel (free hosting)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy from the public/ folder
cd public
vercel

# Set environment variables on Vercel dashboard:
# vercel.com/your-project/settings/environment-variables
# Add all keys from .env.local
```

Your live URL will be: `https://smartflow-yourname.vercel.app`

---

### 6. Push to GitHub

```bash
git init
git add .
git commit -m "initial smartflow deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/smartflow.git
git push -u origin main
```

---

## Running the scrapers continuously (free options)

### Option A: GitHub Actions (completely free)
The repo includes `.github/workflows/scrape.yml` which runs scrapers every 15 minutes using GitHub's free CI minutes.

### Option B: Replit
1. Import this repo into Replit
2. Set Secrets (same as .env)
3. Click Run — it stays alive with Replit's free always-on option

### Option C: Your own machine
Just leave `python scrapers/run_all.py` running in a terminal.

---

## Free tier limits to know

- **Gemini Flash**: 15 requests/min, 1500/day — enough for ~250 wallet analyses/day
- **DEXScreener**: no published limit, be respectful (1 req/sec)
- **4chan API**: no limit, it's public
- **Reddit API**: 60 requests/min on free tier
- **Vercel**: 100GB bandwidth/month, 100 serverless function executions/day on hobby plan

---

## Upgrading later (when you have budget)

| Upgrade | Cost | What it adds |
|---|---|---|
| Birdeye API | $50/mo | Real top-trader PnL data |
| X/Twitter API Basic | $100/mo | Real-time tweet stream |
| Anthropic Claude API | ~$5-20/mo at volume | Better wallet reasoning |
| Vercel Pro | $20/mo | More function executions |

---

## Project structure

```
smartflow/
├── scrapers/
│   ├── fourchan.py        # 4chan /biz/ scraper
│   ├── reddit.py          # Reddit scraper  
│   ├── telegram.py        # Telegram scraper
│   ├── dexscreener.py     # On-chain data fetcher
│   ├── zscore.py          # Z-score calculator
│   └── run_all.py         # Orchestrator
├── api/
│   └── analyze_wallet.py  # Gemini wallet analyzer
├── lib/
│   └── storage.py         # Simple JSON file storage
├── public/                # Next.js frontend
│   ├── pages/
│   │   ├── index.js       # Dashboard
│   │   └── api/           # Serverless API routes
│   ├── components/
│   └── package.json
├── .github/
│   └── workflows/
│       └── scrape.yml     # Free GitHub Actions scheduler
├── requirements.txt
└── README.md
```
